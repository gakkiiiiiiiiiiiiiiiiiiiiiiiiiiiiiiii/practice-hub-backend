/**
 * 数据库迁移脚本
 * 本地: npm run migrate
 * 远程: npm run migrate:remote
 * 指定文件: npm run migrate -- --file=add_course_file_type.sql
 * 仅预览: npm run migrate -- --dry-run
 */
const fs = require('fs');
const path = require('path');

// 加载 dotenv
function loadEnv() {
	try {
		const dotenv = require('dotenv');
		const root = path.resolve(__dirname, '..');
		dotenv.config({ path: path.join(root, '.env') });
		dotenv.config({ path: path.join(root, '.env.local'), override: true });
		if (process.argv.includes('--remote')) {
			const remotePath = path.join(root, '.env.remote');
			if (fs.existsSync(remotePath)) {
				dotenv.config({ path: remotePath, override: true });
				console.log('✓ 已加载 .env.remote');
			}
		}
	} catch (e) {}
}

loadEnv();

const isRemote = process.argv.includes('--remote');
const dryRun = process.argv.includes('--dry-run');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const singleFile = fileArg ? fileArg.split('=')[1] : null;

const dbConfig = isRemote
	? {
			host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
			port: parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306', 10),
			user: process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME,
			password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
			database: process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub',
	  }
	: {
			host: process.env.DB_HOST || 'localhost',
			port: parseInt(process.env.DB_PORT || '3306', 10),
			user: process.env.DB_USERNAME || 'root',
			password: process.env.DB_PASSWORD || '',
			database: process.env.DB_DATABASE || 'practice_hub',
	  };

const migrationsDir = path.resolve(__dirname, '../migrations');

function getSqlFiles() {
	let files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
	files = files.filter((f) => !f.includes('rollback'));
	files.sort();
	if (singleFile) {
		const p = path.join(migrationsDir, singleFile);
		if (!fs.existsSync(p)) {
			console.error('文件不存在:', singleFile);
			process.exit(1);
		}
		return [singleFile];
	}
	return files;
}

async function runMigration(conn, fileName) {
	const sqlPath = path.join(migrationsDir, fileName);
	const sql = fs.readFileSync(sqlPath, 'utf8');
	const usesPreparedStatement = /\b(PREPARE|EXECUTE|DEALLOCATE PREPARE)\b/i.test(sql);

	if (usesPreparedStatement) {
		await conn.query({ sql, multipleStatements: true });
		console.log('  ✓', fileName);
		return;
	}

	// 按分号拆分并逐条执行，避免多语句报错
	const statements = sql
		.split(';')
		.map((s) => s.replace(/--.*$/gm, '').trim())
		.filter((s) => s.length > 0);
	for (const stmt of statements) {
		if (!stmt) continue;
		try {
			await conn.query(stmt + ';');
		} catch (err) {
			const msg = (err.message || '').toString();
			const code = (err.code || '').toString();
			const skip =
				code === 'ER_DUP_FIELDNAME' ||
				code === 'ER_DUP_KEYNAME' ||
				code === 'ER_TABLE_EXISTS_ERROR' ||
				code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
				msg.includes('Duplicate column') ||
				msg.includes('already exists') ||
				msg.includes('Duplicate key') ||
				msg.includes("check that column/key exists");
			if (skip) {
				console.log('    - 跳过幂等错误:', code || msg);
				continue;
			}
			throw err;
		}
	}
	console.log('  ✓', fileName);
}

async function main() {
	if (!dbConfig.host || !dbConfig.user) {
		console.error('错误: 缺少数据库配置');
		if (isRemote) {
			console.error('请配置 .env.remote 或环境变量: REMOTE_DB_HOST, REMOTE_DB_USERNAME, REMOTE_DB_PASSWORD');
		} else {
			console.error('请配置 .env 或环境变量: DB_HOST, DB_USERNAME, DB_PASSWORD');
		}
		process.exit(1);
	}

	const target = isRemote ? '远程' : '本地';
	console.log(`\n执行${target}数据库迁移: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}\n`);

	const files = getSqlFiles();
	if (dryRun) {
		console.log('将执行以下文件:', files.join(', '));
		console.log('\n');
		return;
	}

	const mysql = require('mysql2/promise');
	const conn = await mysql.createConnection({
		host: dbConfig.host,
		port: dbConfig.port,
		user: dbConfig.user,
		password: dbConfig.password || undefined,
		database: dbConfig.database,
		multipleStatements: true,
	});

	try {
		for (const f of files) {
			try {
				await runMigration(conn, f);
			} catch (err) {
				console.error('  ✗', f);
				console.error(err.message);
				throw err;
			}
		}
		console.log('\n迁移完成。\n');
	} finally {
		await conn.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
