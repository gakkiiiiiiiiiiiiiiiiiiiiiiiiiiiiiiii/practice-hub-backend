const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
const envPath = path.join(__dirname, '../.env');
const envLocalPath = path.join(__dirname, '../.env.local');
const envRemotePath = path.join(__dirname, '../.env.remote');

if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
	dotenv.config({ path: envLocalPath, override: true });
}
if (fs.existsSync(envRemotePath)) {
	const result = dotenv.config({ path: envRemotePath, override: true });
	if (!result.error) {
		console.log('✓ 已加载环境变量文件: .env.remote');
	}
}

const isRemote = process.argv.includes('--remote');

async function createExamTables() {
	let connection;

	try {
		if (isRemote) {
			const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST;
			const port = parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306');
			const user = process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME;
			const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
			const database = process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub';

			if (!host || !user) {
				console.error('❌ 远程数据库配置缺失，请检查环境变量：');
				console.error('   REMOTE_DB_HOST 或 DB_HOST');
				console.error('   REMOTE_DB_USERNAME 或 DB_USERNAME');
				console.error('   REMOTE_DB_PASSWORD 或 DB_PASSWORD');
				console.error('   REMOTE_DB_DATABASE 或 DB_DATABASE');
				process.exit(1);
			}

			console.log(`连接远程数据库: ${host}:${port}/${database}`);
			connection = await mysql.createConnection({
				host,
				port,
				user,
				password,
				database,
			});
		} else {
			const host = process.env.DB_HOST || 'localhost';
			const port = parseInt(process.env.DB_PORT || '3306');
			const user = process.env.DB_USERNAME || 'root';
			const password = process.env.DB_PASSWORD || '';
			const database = process.env.DB_DATABASE || 'practice_hub';

			console.log(`连接本地数据库: ${host}:${port}/${database}`);
			connection = await mysql.createConnection({
				host,
				port,
				user,
				password,
				database,
			});
		}

		console.log('✓ 数据库连接成功\n');

		// 读取 SQL 文件
		const sqlPath = path.join(__dirname, '../migrations/create_exam_tables.sql');
		const sql = fs.readFileSync(sqlPath, 'utf8');

		// 执行 SQL
		const statements = sql.split(';').filter((s) => s.trim().length > 0);

		for (const statement of statements) {
			if (statement.trim()) {
				try {
					await connection.execute(statement);
					console.log('✓ 执行成功');
				} catch (error) {
					if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.message.includes('already exists')) {
						console.log('⚠️  表已存在，跳过');
					} else {
						throw error;
					}
				}
			}
		}

		console.log('\n✅ 模拟考试表创建完成！');
	} catch (error) {
		console.error('❌ 创建表失败:', error.message);
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

createExamTables();
