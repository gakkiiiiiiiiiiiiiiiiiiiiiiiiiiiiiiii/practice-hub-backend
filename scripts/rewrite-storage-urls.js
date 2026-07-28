#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const OSS = require('ali-oss');

const LIVE_STORAGE_FIELDS = [
	{ table: 'app_user', field: 'avatar' },
	{ table: 'course', field: 'cover_img' },
	{ table: 'course', field: 'file_url' },
	{ table: 'course_category', field: 'cover_img' },
	{ table: 'course_file', field: 'file_url' },
	{ table: 'distributor', field: 'qr_code_url' },
	{ table: 'feedback', field: 'images' },
	{ table: 'package_section', field: 'cover_img' },
	{ table: 'system_config', field: 'config_value' },
];

function loadEnvironment() {
	const envPath = path.join(process.cwd(), '.env.remote');
	if (!fs.existsSync(envPath)) {
		throw new Error('未找到 .env.remote');
	}
	return { ...dotenv.parse(fs.readFileSync(envPath)), ...process.env };
}

function required(env, key) {
	const value = String(env[key] || '').trim();
	if (!value) throw new Error(`缺少环境变量 ${key}`);
	return value;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeObjectKey(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function encodeObjectKey(value) {
	return value
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

function valueToText(value) {
	if (value === null || value === undefined) return '';
	return typeof value === 'string' ? value : JSON.stringify(value);
}

async function listOssObjectKeys(client) {
	const keys = new Set();
	let marker;
	let pages = 0;
	do {
		const result = await client.list({ marker, 'max-keys': 1000 }, {});
		for (const object of result.objects || []) keys.add(object.name);
		marker = result.isTruncated ? result.nextMarker : undefined;
		pages += 1;
		if (pages % 50 === 0) {
			console.log(`已读取 OSS 对象清单：${keys.size}`);
		}
	} while (marker);
	return keys;
}

function rewriteEligibleUrls(text, sources, targetBase, ossKeys) {
	let changed = false;
	let eligibleObjects = 0;
	let missingObjects = 0;
	let output = text;

	for (const source of sources) {
		const pattern = new RegExp(`${escapeRegExp(source)}/([^"'\\\\\\s?&#]+)`, 'g');
		output = output.replace(pattern, (matched, encodedKey) => {
			const key = decodeObjectKey(encodedKey);
			if (!ossKeys.has(key)) {
				missingObjects += 1;
				return matched;
			}
			changed = true;
			eligibleObjects += 1;
			return `${targetBase}/${encodeObjectKey(key)}`;
		});
	}

	return { changed, output, eligibleObjects, missingObjects };
}

function timestampForFile() {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
	const env = loadEnvironment();
	const apply = process.argv.includes('--apply');
	const sourceBucket = env.OSS_LEGACY_COS_BUCKET || '7072-prod-d1gguk4ie589126ba-1424780330';
	const sourceRegion = env.OSS_LEGACY_COS_REGION || 'ap-shanghai';
	const sourceEnvId = env.OSS_LEGACY_COS_ENV_ID || 'prod-d1gguk4ie589126ba';
	const targetBucket = required(env, 'OSS_BUCKET');
	const targetRegion = env.OSS_REGION || 'oss-cn-shanghai';
	const targetBase = String(
		env.OSS_PUBLIC_BASE_URL || `https://${targetBucket}.${targetRegion}.aliyuncs.com`,
	).replace(/\/$/, '');
	const sources = [
		`https://${sourceBucket}.tcb.qcloud.la`,
		`https://${sourceBucket}.cos.${sourceRegion}.myqcloud.com`,
		`cloud://${sourceEnvId}.${sourceBucket}`,
	];

	const oss = new OSS({
		region: targetRegion,
		bucket: targetBucket,
		accessKeyId: required(env, 'OSS_ACCESS_KEY_ID'),
		accessKeySecret: required(env, 'OSS_ACCESS_KEY_SECRET'),
		timeout: 60 * 1000,
	});
	const connection = await mysql.createConnection({
		host: required(env, 'REMOTE_DB_HOST'),
		port: Number(env.REMOTE_DB_PORT || 3306),
		user: required(env, 'REMOTE_DB_USERNAME'),
		password: required(env, 'REMOTE_DB_PASSWORD'),
		database: required(env, 'REMOTE_DB_DATABASE'),
		charset: 'utf8mb4',
	});

	try {
		console.log('正在读取 OSS 对象清单...');
		const ossKeys = await listOssObjectKeys(oss);
		console.log(`OSS 对象清单读取完成：${ossKeys.size}`);

		const changes = [];
		const report = [];
		for (const { table, field } of LIVE_STORAGE_FIELDS) {
			const where = sources.map(() => `CAST(\`${field}\` AS CHAR) LIKE ?`).join(' OR ');
			const [rows] = await connection.query(
				`SELECT \`id\`, \`${field}\` AS value FROM \`${table}\` WHERE ${where}`,
				sources.map((source) => `%${source}%`),
			);
			let eligibleRows = 0;
			let eligibleObjects = 0;
			let missingObjects = 0;
			for (const row of rows) {
				const oldValue = valueToText(row.value);
				const rewritten = rewriteEligibleUrls(oldValue, sources, targetBase, ossKeys);
				eligibleObjects += rewritten.eligibleObjects;
				missingObjects += rewritten.missingObjects;
				if (!rewritten.changed || rewritten.output === oldValue) continue;
				eligibleRows += 1;
				changes.push({
					table,
					field,
					id: row.id,
					oldValue,
					newValue: rewritten.output,
				});
			}
			report.push({
				field: `${table}.${field}`,
				legacyRows: rows.length,
				eligibleRows,
				eligibleObjects,
				missingObjects,
			});
		}

		console.table(report);
		console.log(`目标地址：${targetBase}`);
		console.log(`本轮可安全替换：${changes.length} 行`);
		if (!apply) {
			console.log('当前为预演模式，未修改数据库；确认后使用 --apply 执行。');
			return;
		}
		if (changes.length === 0) {
			console.log('没有可安全替换的记录。');
			return;
		}

		const backupPath = path.join(
			process.cwd(),
			'exports',
			`storage-url-rewrite-backup-${timestampForFile()}.json`,
		);
		fs.mkdirSync(path.dirname(backupPath), { recursive: true });
		fs.writeFileSync(
			backupPath,
			JSON.stringify(
				{
					createdAt: new Date().toISOString(),
					targetBase,
					sources,
					changes,
				},
				null,
				2,
			),
		);

		await connection.beginTransaction();
		let updatedRows = 0;
		try {
			for (const change of changes) {
				const [result] = await connection.query(
					`UPDATE \`${change.table}\`
					 SET \`${change.field}\` = ?
					 WHERE \`id\` = ? AND CAST(\`${change.field}\` AS CHAR) = ?`,
					[change.newValue, change.id, change.oldValue],
				);
				updatedRows += Number(result.affectedRows || 0);
			}
			if (updatedRows !== changes.length) {
				throw new Error(`并发保护校验失败：计划 ${changes.length} 行，实际更新 ${updatedRows} 行`);
			}
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}

		console.log(`增量替换完成：${updatedRows} 行`);
		console.log(`回滚备份：${backupPath}`);
	} finally {
		await connection.end();
	}
}

main().catch((error) => {
	console.error(`对象存储 URL 改写失败: ${error.message}`);
	process.exit(1);
});
