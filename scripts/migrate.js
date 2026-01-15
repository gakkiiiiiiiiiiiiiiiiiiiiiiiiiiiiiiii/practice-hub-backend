/**
 * 通用数据库迁移脚本
 * 使用方法：
 *  - node scripts/migrate.js
 *  - node scripts/migrate.js --remote
 *  - node scripts/migrate.js --file add_agent_price_to_course.sql
 *  - node scripts/migrate.js --file=add_agent_price_to_course.sql --remote
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const args = process.argv.slice(2);

const getArgValue = (flag) => {
	const index = args.indexOf(flag);
	if (index === -1) return null;
	return args[index + 1] || null;
};

const fileArg = args.find((arg) => arg.startsWith('--file='));
const fileName = fileArg ? fileArg.split('=')[1] : getArgValue('--file');
const isRemote = args.includes('--remote');
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');

const envPath = path.join(__dirname, '../.env');
const envLocalPath = path.join(__dirname, '../.env.local');
const envRemotePath = path.join(__dirname, '../.env.remote');

if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
	dotenv.config({ path: envLocalPath, override: true });
}
if (isRemote && fs.existsSync(envRemotePath)) {
	dotenv.config({ path: envRemotePath, override: true });
	console.log('✓ 已加载环境变量文件: .env.remote');
}

const getDbConfig = () => {
	if (isRemote) {
		return {
			host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
			port: parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306'),
			user: process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME,
			password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD || '',
			database: process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub',
			multipleStatements: true,
		};
	}

	return {
		host: process.env.DB_HOST || 'localhost',
		port: parseInt(process.env.DB_PORT || '3306'),
		user: process.env.DB_USERNAME || 'root',
		password: process.env.DB_PASSWORD || '',
		database: process.env.DB_DATABASE || 'practice_hub',
		multipleStatements: true,
	};
};

const ensureMigrationTable = async (connection) => {
	await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getAppliedMigrations = async (connection) => {
	const [rows] = await connection.query('SELECT filename FROM schema_migrations');
	return new Set(rows.map((row) => row.filename));
};

const loadMigrationFiles = (migrationsDir) => {
	const files = fs
		.readdirSync(migrationsDir)
		.filter((file) => file.endsWith('.sql'))
		.filter((file) => !file.startsWith('rollback_'))
		.sort();

	if (fileName) {
		if (!files.includes(fileName)) {
			throw new Error(`迁移文件不存在: ${fileName}`);
		}
		return [fileName];
	}

	return files;
};

async function runMigrations() {
	let connection;
	const migrationsDir = path.join(__dirname, '../migrations');

	try {
		const dbConfig = getDbConfig();

		if (!dbConfig.host || !dbConfig.user) {
			throw new Error('数据库配置缺失，请检查 .env 或 .env.remote');
		}

		console.log(`连接数据库: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
		connection = await mysql.createConnection(dbConfig);
		console.log('✅ 数据库连接成功\n');

		await ensureMigrationTable(connection);
		const applied = await getAppliedMigrations(connection);
		const files = loadMigrationFiles(migrationsDir);

		if (files.length === 0) {
			console.log('⚠️  未找到可执行的迁移脚本');
			return;
		}

		console.log(`待执行迁移数量: ${files.length}\n`);

		for (const file of files) {
			if (!isForce && applied.has(file)) {
				console.log(`⏭️  已执行，跳过: ${file}`);
				continue;
			}

			const filePath = path.join(migrationsDir, file);
			const sql = fs.readFileSync(filePath, 'utf8').trim();

			if (!sql) {
				console.log(`⚠️  空文件，跳过: ${file}`);
				continue;
			}

			if (isDryRun) {
				console.log(`🧪 [dry-run] 将执行: ${file}`);
				continue;
			}

			console.log(`🚀 执行迁移: ${file}`);
			await connection.query(sql);
			await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
			console.log(`✅ 完成: ${file}\n`);
		}

		console.log('🎉 所有迁移执行完成');
	} catch (error) {
		console.error('\n❌ 迁移执行失败:');
		console.error(error.message);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

runMigrations();
