const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 检查是否使用远程数据库
const isRemote = process.argv.includes('--remote');

// 加载环境变量
const envPath = path.join(__dirname, '../.env');
const envRemotePath = path.join(__dirname, '../.env.remote');
if (isRemote && fs.existsSync(envRemotePath)) {
	dotenv.config({ path: envRemotePath });
	console.log('✓ 已加载环境变量文件: .env.remote');
} else if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}

// 从环境变量读取数据库配置
const DB_CONFIG = {
	host: isRemote ? process.env.REMOTE_DB_HOST || 'localhost' : process.env.DB_HOST || 'localhost',
	port: isRemote ? parseInt(process.env.REMOTE_DB_PORT || '3306') : parseInt(process.env.DB_PORT || '3306'),
	user: isRemote ? process.env.REMOTE_DB_USERNAME || 'root' : process.env.DB_USERNAME || 'root',
	password: isRemote ? process.env.REMOTE_DB_PASSWORD || '' : process.env.DB_PASSWORD || '',
	database: isRemote ? process.env.REMOTE_DB_DATABASE || 'practice_hub' : process.env.DB_DATABASE || 'practice_hub',
};

async function checkTableExists(connection, tableName) {
	try {
		const [rows] = await connection.query(
			`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
			[DB_CONFIG.database, tableName]
		);
		return rows[0].count > 0;
	} catch {
		return false;
	}
}

async function createCourseRecommendationTable() {
	let connection;

	try {
		console.log('正在连接数据库...');
		console.log(`数据库: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
		console.log(`用户: ${DB_CONFIG.user}\n`);

		if (!DB_CONFIG.host || !DB_CONFIG.user || !DB_CONFIG.password) {
			console.error('❌ 错误: 缺少数据库配置');
			console.error('\n请设置以下环境变量:');
			if (isRemote) {
				console.error('  REMOTE_DB_HOST=远程数据库地址');
				console.error('  REMOTE_DB_PORT=3306');
				console.error('  REMOTE_DB_USERNAME=用户名');
				console.error('  REMOTE_DB_PASSWORD=密码');
				console.error('  REMOTE_DB_DATABASE=practice_hub');
			} else {
				console.error('  DB_HOST=数据库地址');
				console.error('  DB_PORT=3306');
				console.error('  DB_USERNAME=用户名');
				console.error('  DB_PASSWORD=密码');
				console.error('  DB_DATABASE=practice_hub');
			}
			process.exit(1);
		}

		connection = await mysql.createConnection(DB_CONFIG);
		console.log('✅ 数据库连接成功\n');

		console.log('========================================');
		console.log('创建课程相关推荐表');
		console.log('========================================\n');

		// 检查表是否已存在
		const tableExists = await checkTableExists(connection, 'course_recommendation');
		if (tableExists) {
			console.log('✅ course_recommendation 表已存在，跳过创建\n');
		} else {
			console.log('正在创建 course_recommendation 表...');

			// 读取 SQL 文件
			const sqlPath = path.join(__dirname, '../migrations/create_course_recommendation_table.sql');
			const sql = fs.readFileSync(sqlPath, 'utf-8');

			// 执行 SQL
			await connection.query(sql);
			console.log('✅ course_recommendation 表创建成功\n');
		}

		// 验证表结构
		console.log('验证表结构...');
		const [columns] = await connection.query(
			`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
			 FROM information_schema.COLUMNS 
			 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'course_recommendation'
			 ORDER BY ORDINAL_POSITION`,
			[DB_CONFIG.database]
		);

		console.log('\n表结构:');
		columns.forEach((col) => {
			console.log(
				`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}${col.COLUMN_COMMENT ? ` (${col.COLUMN_COMMENT})` : ''}`
			);
		});

		console.log('\n========================================');
		console.log('✅ 迁移完成！');
		console.log('========================================\n');
	} catch (error) {
		console.error('\n❌ 迁移失败:', error.message);
		if (error.code) {
			console.error('错误代码:', error.code);
		}
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

// 执行迁移
createCourseRecommendationTable();
