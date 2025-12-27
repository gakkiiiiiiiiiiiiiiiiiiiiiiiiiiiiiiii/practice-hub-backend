/**
 * 修改 user_answer_log 表的 is_correct 字段，允许 NULL 值
 * 使用方法：node scripts/fix-is-correct-nullable.js [--remote]
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量（支持多个文件，按优先级加载）
const envPath = path.join(__dirname, '../.env');
const envLocalPath = path.join(__dirname, '../.env.local');
const envRemotePath = path.join(__dirname, '../.env.remote');

// 先加载 .env（基础配置）
if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}

// 再加载 .env.local（本地覆盖）
if (fs.existsSync(envLocalPath)) {
	dotenv.config({ path: envLocalPath, override: true });
}

// 最后加载 .env.remote（远程配置，优先级最高）
if (fs.existsSync(envRemotePath)) {
	const result = dotenv.config({ path: envRemotePath, override: true });
	if (!result.error) {
		console.log('✓ 已加载环境变量文件: .env.remote');
	}
}

async function fixIsCorrectNullable(isRemote = false) {
	let connection;

	try {
		// 根据参数选择连接配置
		if (isRemote) {
			console.log('连接到远程数据库...');

			// 检查环境变量
			const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST;
			const port = parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306');
			const user = process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME;
			const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
			const database = process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub';

			if (!host || !user) {
				console.error('❌ 环境变量未设置！');
				console.error('\n请设置以下环境变量（在 .env.remote 文件中）：');
				console.error('  REMOTE_DB_HOST=远程数据库地址');
				console.error('  REMOTE_DB_PORT=3306');
				console.error('  REMOTE_DB_USERNAME=用户名');
				console.error('  REMOTE_DB_PASSWORD=密码');
				console.error('  REMOTE_DB_DATABASE=practice_hub');
				process.exit(1);
			}

			connection = await mysql.createConnection({
				host,
				port,
				user,
				password,
				database,
			});
			console.log(`✅ 已连接到远程数据库: ${host}:${port}`);
		} else {
			console.log('连接到本地数据库...');
			connection = await mysql.createConnection({
				host: process.env.DB_HOST || 'localhost',
				port: parseInt(process.env.DB_PORT || '3306'),
				user: process.env.DB_USERNAME || 'root',
				password: process.env.DB_PASSWORD || '',
				database: process.env.DB_DATABASE || 'practice_hub',
			});
			console.log(`✅ 已连接到本地数据库: ${process.env.DB_HOST || 'localhost'}`);
		}

		// 检查字段当前状态
		const [columns] = await connection.execute("SHOW COLUMNS FROM `user_answer_log` WHERE Field = 'is_correct'");

		if (columns.length === 0) {
			console.error('❌ 字段 is_correct 不存在');
			process.exit(1);
		}

		const column = columns[0];
		const isNullable = column.Null === 'YES';

		if (isNullable) {
			console.log('✅ 字段 is_correct 已经允许 NULL 值，无需修改');
		} else {
			console.log('修改字段 is_correct，允许 NULL 值...');
			await connection.execute(`
				ALTER TABLE \`user_answer_log\`
				MODIFY COLUMN \`is_correct\` TINYINT NULL COMMENT '0-错误, 1-正确, null-待批改（简答题）'
			`);
			console.log('✅ 字段 is_correct 修改成功，现在允许 NULL 值');
		}

		// 显示表结构
		console.log('\n📋 当前字段状态:');
		const [structure] = await connection.execute("SHOW COLUMNS FROM `user_answer_log` WHERE Field = 'is_correct'");
		console.table(structure);

		console.log('\n✅ 修改完成！');
	} catch (error) {
		console.error('❌ 执行失败:', error.message);
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

// 解析命令行参数
const args = process.argv.slice(2);
const isRemote = args.includes('--remote');

console.log('========================================');
console.log('修改 is_correct 字段允许 NULL');
console.log('========================================\n');

fixIsCorrectNullable(isRemote).catch((error) => {
	console.error('执行失败:', error);
	process.exit(1);
});

