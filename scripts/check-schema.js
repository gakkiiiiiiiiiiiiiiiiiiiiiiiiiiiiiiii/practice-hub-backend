/**
 * 数据库结构漂移检查
 * 本地: npm run check:schema
 * 远程: npm run check:schema:remote
 */
const fs = require('fs');
const path = require('path');

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

function getDbConfig(isRemote) {
	return isRemote
		? {
				host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
				port: parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306', 10),
				username: process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME,
				password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
				database: process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub',
		  }
		: {
				host: process.env.DB_HOST || 'localhost',
				port: parseInt(process.env.DB_PORT || '3306', 10),
				username: process.env.DB_USERNAME || 'root',
				password: process.env.DB_PASSWORD || '',
				database: process.env.DB_DATABASE || 'practice_hub',
		  };
}

function resolveEntitiesGlob() {
	const sourceEntitiesDir = path.resolve(__dirname, '../src/database/entities');
	if (fs.existsSync(sourceEntitiesDir)) {
		require('ts-node/register/transpile-only');
		require('tsconfig-paths/register');
		return path.join(sourceEntitiesDir, '*.entity.ts');
	}

	return path.resolve(__dirname, '../dist/database/entities/*.entity.js');
}

async function main() {
	loadEnv();
	require('reflect-metadata');
	const { DataSource } = require('typeorm');

	const isRemote = process.argv.includes('--remote');
	const dbConfig = getDbConfig(isRemote);
	if (!dbConfig.host || !dbConfig.username) {
		console.error('错误: 缺少数据库配置');
		process.exit(1);
	}

	const target = isRemote ? '远程' : '本地';
	console.log(`\n检查${target}数据库结构: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}\n`);

	const dataSource = new DataSource({
		type: 'mysql',
		host: dbConfig.host,
		port: dbConfig.port,
		username: dbConfig.username,
		password: dbConfig.password || undefined,
		database: dbConfig.database,
		entities: [resolveEntitiesGlob()],
		synchronize: false,
		logging: false,
		timezone: '+08:00',
		charset: 'utf8mb4',
	});

	await dataSource.initialize();

	try {
		const missingTables = [];
		const missingColumns = [];
		const metadatas = dataSource.entityMetadatas
			.filter((metadata) => !metadata.tableType || metadata.tableType === 'regular')
			.sort((a, b) => a.tableName.localeCompare(b.tableName));

		for (const metadata of metadatas) {
			const rows = await dataSource.query(
				'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
				[metadata.tableName],
			);
			if (rows.length === 0) {
				missingTables.push(metadata.tableName);
				continue;
			}

			const existingColumns = new Set(rows.map((row) => row.COLUMN_NAME));
			const requiredColumns = [...new Set(metadata.columns.map((column) => column.databaseName))];
			const missing = requiredColumns.filter((column) => !existingColumns.has(column));
			if (missing.length > 0) {
				missingColumns.push({ table: metadata.tableName, columns: missing });
			}
		}

		if (missingTables.length === 0 && missingColumns.length === 0) {
			console.log(`✓ 数据库结构检查通过，共检查 ${metadatas.length} 张实体表。\n`);
			return;
		}

		if (missingTables.length > 0) {
			console.error('缺失表:');
			missingTables.forEach((table) => console.error(`  - ${table}`));
		}

		if (missingColumns.length > 0) {
			console.error('缺失字段:');
			missingColumns.forEach(({ table, columns }) => {
				console.error(`  - ${table}: ${columns.join(', ')}`);
			});
		}

		console.error('\n数据库结构与实体定义不一致，请先执行相应迁移。\n');
		process.exitCode = 1;
	} finally {
		await dataSource.destroy();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
