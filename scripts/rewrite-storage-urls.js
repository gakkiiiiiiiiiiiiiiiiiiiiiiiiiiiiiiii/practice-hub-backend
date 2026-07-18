#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

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

function assertIdentifier(value, label) {
	if (!/^[a-zA-Z0-9_$]+$/.test(value)) {
		throw new Error(`${label} 包含不安全字符: ${value}`);
	}
}

async function main() {
	const env = loadEnvironment();
	const apply = process.argv.includes('--apply');
	const sourceBucket = env.OSS_LEGACY_COS_BUCKET || '7072-prod-6g7tpqs40c5a758b-1392943725';
	const sourceRegion = env.OSS_LEGACY_COS_REGION || 'ap-shanghai';
	const targetBucket = required(env, 'OSS_BUCKET');
	const targetRegion = env.OSS_REGION || 'oss-cn-shanghai';
	const targetBase = String(
		env.OSS_PUBLIC_BASE_URL || `https://${targetBucket}.${targetRegion}.aliyuncs.com`,
	).replace(/\/$/, '');
	const replacements = [
		[`https://${sourceBucket}.tcb.qcloud.la`, targetBase],
		[`https://${sourceBucket}.cos.${sourceRegion}.myqcloud.com`, targetBase],
	];

	const connection = await mysql.createConnection({
		host: required(env, 'REMOTE_DB_HOST'),
		port: Number(env.REMOTE_DB_PORT || 3306),
		user: required(env, 'REMOTE_DB_USERNAME'),
		password: required(env, 'REMOTE_DB_PASSWORD'),
		database: required(env, 'REMOTE_DB_DATABASE'),
		charset: 'utf8mb4',
	});

	try {
		const [columns] = await connection.query(
			`SELECT TABLE_NAME, COLUMN_NAME
			 FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE()
			   AND DATA_TYPE IN ('char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'json')`,
		);
		const matches = [];
		for (const column of columns) {
			const table = column.TABLE_NAME;
			const field = column.COLUMN_NAME;
			assertIdentifier(table, '表名');
			assertIdentifier(field, '字段名');
			for (const [source] of replacements) {
				const [rows] = await connection.query(
					`SELECT COUNT(*) AS count FROM \`${table}\` WHERE CAST(\`${field}\` AS CHAR) LIKE ?`,
					[`%${source}%`],
				);
				const count = Number(rows[0]?.count || 0);
				if (count > 0) matches.push({ table, field, source, count });
			}
		}

		if (matches.length === 0) {
			console.log('未发现需要改写的腾讯云对象存储 URL');
			return;
		}

		console.table(matches.map(({ table, field, count }) => ({ table, field, rows: count })));
		if (!apply) {
			console.log('当前为预览模式；确认文件迁移完成后执行 npm run storage:rewrite-urls:apply');
			return;
		}

		await connection.beginTransaction();
		try {
			let affectedRows = 0;
			for (const { table, field, source } of matches) {
				const target = replacements.find(([candidate]) => candidate === source)[1];
				const [result] = await connection.query(
					`UPDATE \`${table}\` SET \`${field}\` = REPLACE(\`${field}\`, ?, ?) WHERE CAST(\`${field}\` AS CHAR) LIKE ?`,
					[source, target, `%${source}%`],
				);
				affectedRows += Number(result.affectedRows || 0);
			}
			await connection.commit();
			console.log(`对象存储 URL 改写完成，更新 ${affectedRows} 行`);
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	} finally {
		await connection.end();
	}
}

main().catch((error) => {
	console.error(`对象存储 URL 改写失败: ${error.message}`);
	process.exit(1);
});
