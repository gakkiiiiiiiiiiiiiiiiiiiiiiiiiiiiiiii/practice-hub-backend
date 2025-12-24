/**
 * 数据库迁移执行脚本
 * 使用方法：node scripts/run-migration.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DB_CONFIG = {
	host: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '3306'),
	user: process.env.DB_USERNAME || 'root',
	password: process.env.DB_PASSWORD || 'root123456',
	database: process.env.DB_DATABASE || 'practice_hub',
	multipleStatements: true, // 允许执行多条 SQL
};

async function runMigration() {
	let connection;

	try {
		console.log('正在连接数据库...');
		console.log(`数据库: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);

		connection = await mysql.createConnection(DB_CONFIG);
		console.log('✅ 数据库连接成功\n');

		// 读取迁移脚本
		const migrationFile = path.join(__dirname, '../migrations/migrate_subject_to_course.sql');

		if (!fs.existsSync(migrationFile)) {
			throw new Error(`迁移文件不存在: ${migrationFile}`);
		}

		const sql = fs.readFileSync(migrationFile, 'utf8');

		console.log('⚠️  警告：即将执行数据库迁移！');
		console.log('⚠️  请确保已经备份数据库！\n');

		// 询问确认（在实际使用中，可以添加命令行参数来跳过确认）
		console.log('开始执行迁移...\n');

		// 执行迁移
		console.log('执行 SQL 迁移脚本...');
		await connection.query(sql);
		console.log('✅ 迁移脚本执行完成\n');

		// 验证迁移结果
		console.log('验证迁移结果...');

		// 检查表是否存在
		const [tables] = await connection.query('SHOW TABLES');
		const tableNames = tables.map((t) => Object.values(t)[0]);

		if (tableNames.includes('course')) {
			console.log('✅ course 表存在');
		} else {
			console.log('❌ course 表不存在');
		}

		if (tableNames.includes('user_course_auth')) {
			console.log('✅ user_course_auth 表存在');
		} else {
			console.log('❌ user_course_auth 表不存在');
		}

		// 检查 course 表结构
		const [courseFields] = await connection.query('DESCRIBE course');
		const fieldNames = courseFields.map((f) => f.Field);

		const requiredFields = ['subject', 'school', 'major', 'exam_year', 'answer_year'];
		const missingFields = requiredFields.filter((f) => !fieldNames.includes(f));

		if (missingFields.length === 0) {
			console.log('✅ course 表新字段已添加');
		} else {
			console.log(`❌ course 表缺少字段: ${missingFields.join(', ')}`);
		}

		// 检查数据完整性
		const [courseCount] = await connection.query('SELECT COUNT(*) as count FROM course');
		const [chapterCount] = await connection.query('SELECT COUNT(*) as count FROM chapter');
		const [authCount] = await connection.query('SELECT COUNT(*) as count FROM user_course_auth');

		console.log(`\n数据统计:`);
		console.log(`  - course 表: ${courseCount[0].count} 条记录`);
		console.log(`  - chapter 表: ${chapterCount[0].count} 条记录`);
		console.log(`  - user_course_auth 表: ${authCount[0].count} 条记录`);

		console.log('\n✅ 迁移完成！');
		console.log('请重启后端服务以使更改生效。\n');
	} catch (error) {
		console.error('\n❌ 迁移失败:');
		console.error(error.message);
		console.error('\n请检查错误信息并修复后重试。');
		console.error('如果迁移部分完成，请从备份恢复数据库。\n');
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
			console.log('数据库连接已关闭');
		}
	}
}

// 执行迁移
runMigration();
