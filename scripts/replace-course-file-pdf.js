#!/usr/bin/env node

/**
 * 用已修复/压缩的 PDF 替换指定课程文件。
 *
 * 默认仅校验，不修改线上数据：
 *   npm run course-file:replace-pdf -- --file-id 1065 --input /path/to/fixed.pdf
 *
 * 确认后执行：
 *   npm run course-file:replace-pdf -- --file-id 1065 --input /path/to/fixed.pdf --apply
 *
 * 脚本会上传到新的 OSS 对象，再用数据库事务切换 URL。旧对象不会删除，可回滚。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const OSS = require('ali-oss');

const REMOTE_ENV_FILE = path.resolve(__dirname, '../.env.remote');
const PREVIEW_VERSION_SUFFIX = 'full|jpeg|1440|160|90|direct-page-v7';

function parseArgs(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const item = argv[index];
		if (item === '--apply') {
			args.apply = true;
			continue;
		}
		if (item.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
			args[item.slice(2)] = argv[index + 1];
			index += 1;
		}
	}
	return args;
}

function required(env, name) {
	const value = String(env[name] || '').trim();
	if (!value) throw new Error(`缺少环境变量 ${name}`);
	return value;
}

function inspectPdf(inputPath) {
	const output = execFileSync('pdfinfo', [inputPath], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024,
	});
	const pagesMatch = output.match(/^Pages:\s+(\d+)$/m);
	if (!pagesMatch) throw new Error('无法从 pdfinfo 读取 PDF 页数');
	const pageCount = Number(pagesMatch[1]);
	if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('PDF 页数无效');
	return { pageCount };
}

function buildPreviewPageCountKey(fileUrl) {
	return crypto
		.createHash('md5')
		.update(`${fileUrl}|${PREVIEW_VERSION_SUFFIX}`)
		.digest('hex')
		.slice(0, 12);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const fileId = Number(args['file-id']);
	const inputPath = path.resolve(String(args.input || ''));
	if (!Number.isInteger(fileId) || fileId < 1) throw new Error('--file-id 必须是正整数');
	if (!args.input || !fs.existsSync(inputPath)) throw new Error('--input 指向的 PDF 不存在');
	if (path.extname(inputPath).toLowerCase() !== '.pdf') throw new Error('--input 必须是 PDF 文件');

	const fileStat = fs.statSync(inputPath);
	if (!fileStat.isFile() || fileStat.size < 8) throw new Error('输入 PDF 为空');
	const header = Buffer.alloc(4);
	const descriptor = fs.openSync(inputPath, 'r');
	try {
		fs.readSync(descriptor, header, 0, header.length, 0);
	} finally {
		fs.closeSync(descriptor);
	}
	if (header.toString() !== '%PDF') throw new Error('输入文件不是有效 PDF');

	const { pageCount } = inspectPdf(inputPath);
	const fileEnv = dotenv.parse(fs.readFileSync(REMOTE_ENV_FILE));
	const env = { ...fileEnv, ...process.env };
	const db = await mysql.createConnection({
		host: required(env, 'REMOTE_DB_HOST'),
		port: Number(env.REMOTE_DB_PORT || 3306),
		user: required(env, 'REMOTE_DB_USERNAME'),
		password: required(env, 'REMOTE_DB_PASSWORD'),
		database: required(env, 'REMOTE_DB_DATABASE'),
		connectTimeout: 15000,
	});

	let uploadedKey = '';
	let oss;
	try {
		const [rows] = await db.execute(
			`SELECT cf.id, cf.course_id, cf.file_name, cf.file_type, cf.file_size, cf.file_url,
			        c.name AS course_name
			   FROM course_file cf
			   JOIN course c ON c.id = cf.course_id
			  WHERE cf.id = ? AND cf.status = 1`,
			[fileId],
		);
		if (rows.length !== 1) throw new Error(`课程文件 ${fileId} 不存在或已禁用`);
		const current = rows[0];
		if (String(current.file_type).toLowerCase() !== 'pdf') {
			throw new Error(`课程文件 ${fileId} 不是 PDF`);
		}
		const [primaryRows] = await db.execute(
			`SELECT id
			   FROM course_file
			  WHERE course_id = ? AND status = 1
			  ORDER BY sort ASC, id ASC
			  LIMIT 1`,
			[current.course_id],
		);
		const isPrimaryFile = Number(primaryRows[0]?.id) === fileId;

		const summary = {
			fileId,
			courseId: current.course_id,
			courseName: current.course_name,
			oldSize: Number(current.file_size),
			newSize: fileStat.size,
			pageCount,
			mode: args.apply ? 'apply' : 'dry-run',
		};
		console.log(JSON.stringify(summary, null, 2));
		if (!args.apply) {
			console.log('校验通过；添加 --apply 后才会上传并切换线上文件。');
			return;
		}

		oss = new OSS({
			region: env.OSS_REGION || 'oss-cn-shanghai',
			bucket: required(env, 'OSS_BUCKET'),
			accessKeyId: required(env, 'OSS_ACCESS_KEY_ID'),
			accessKeySecret: required(env, 'OSS_ACCESS_KEY_SECRET'),
			...(env.OSS_ENDPOINT ? { endpoint: env.OSS_ENDPOINT } : {}),
			timeout: 10 * 60 * 1000,
		});
		const hash = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex').slice(0, 12);
		uploadedKey = `course-files/repaired/file-${fileId}-${hash}.pdf`;
		await oss.multipartUpload(uploadedKey, inputPath, {
			parallel: 4,
			partSize: 5 * 1024 * 1024,
			headers: { 'Content-Type': 'application/pdf' },
		});
		const head = await oss.head(uploadedKey);
		const uploadedSize = Number(head.res?.headers?.['content-length']);
		if (uploadedSize !== fileStat.size) {
			throw new Error(`上传后大小校验失败：本地 ${fileStat.size}，远端 ${uploadedSize}`);
		}

		const publicBaseUrl = String(
			env.OSS_PUBLIC_BASE_URL ||
				`https://${required(env, 'OSS_BUCKET')}.${env.OSS_REGION || 'oss-cn-shanghai'}.aliyuncs.com`,
		).replace(/\/+$/, '');
		const nextUrl = `${publicBaseUrl}/${uploadedKey.split('/').map(encodeURIComponent).join('/')}`;
		const pageCountKey = buildPreviewPageCountKey(nextUrl);

		await db.beginTransaction();
		try {
			await db.execute(
				`UPDATE course_file
				    SET file_url = ?, file_size = ?, file_page_count = ?, file_page_count_key = ?
				  WHERE id = ?`,
				[nextUrl, fileStat.size, pageCount, pageCountKey, fileId],
			);
			if (isPrimaryFile) {
				await db.execute(
					`UPDATE course
					    SET file_url = ?, file_size = ?, file_page_count = ?, file_page_count_key = ?
					  WHERE id = ?`,
					[nextUrl, fileStat.size, pageCount, pageCountKey, current.course_id],
				);
			}
			await db.commit();
		} catch (error) {
			await db.rollback();
			throw error;
		}

		console.log(
			JSON.stringify(
				{
					success: true,
					fileId,
					courseId: current.course_id,
					oldUrl: current.file_url,
					newUrl: nextUrl,
					oldSize: Number(current.file_size),
					newSize: fileStat.size,
					pageCount,
					oldObjectRetained: true,
				},
				null,
				2,
			),
		);
	} catch (error) {
		if (uploadedKey && oss) {
			try {
				await oss.delete(uploadedKey);
			} catch (_) {}
		}
		throw error;
	} finally {
		await db.end();
	}
}

main().catch((error) => {
	console.error(`[replace-course-file-pdf] ${error.message}`);
	process.exit(1);
});
