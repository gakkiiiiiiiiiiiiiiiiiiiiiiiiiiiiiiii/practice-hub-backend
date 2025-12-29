const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
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

async function addChapterIdField(isRemote = false) {
	let connection;

	try {
		if (isRemote) {
			const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST;
			const port = parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306');
			const user = process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME;
			const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
			const database = process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub';

			if (!host || !user) {
				console.error('❌ 远程数据库配置不完整');
				console.error('请设置以下环境变量：');
				console.error('  REMOTE_DB_HOST 或 DB_HOST');
				console.error('  REMOTE_DB_USERNAME 或 DB_USERNAME');
				console.error('  REMOTE_DB_PASSWORD 或 DB_PASSWORD');
				console.error('  REMOTE_DB_DATABASE 或 DB_DATABASE');
				process.exit(1);
			}

			console.log(`🔗 连接到远程数据库: ${host}:${port}/${database}`);
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

			console.log(`🔗 连接到本地数据库: ${host}:${port}/${database}`);
			connection = await mysql.createConnection({
				host,
				port,
				user,
				password,
				database,
			});
		}

		// 检查表是否存在
		const [tables] = await connection.execute("SHOW TABLES LIKE 'user_answer_log'");

		if (tables.length === 0) {
			console.error('❌ 表 user_answer_log 不存在');
			process.exit(1);
		}

		console.log('✅ 表 user_answer_log 存在');

		// 检查字段是否存在
		const [columns] = await connection.execute("SHOW COLUMNS FROM `user_answer_log` LIKE 'chapter_id'");

		if (columns.length > 0) {
			console.log('⚠️  字段 chapter_id 已存在，跳过添加');
		} else {
			console.log('添加字段 chapter_id...');
			await connection.execute(`
        ALTER TABLE \`user_answer_log\`
        ADD COLUMN \`chapter_id\` INT NOT NULL COMMENT '章节ID（冗余字段，便于查询）' AFTER \`question_id\`
      `);
			console.log('✅ 字段 chapter_id 添加成功');
		}

		// 更新现有数据的 chapter_id
		console.log('更新现有记录的 chapter_id...');
		const [updateResult] = await connection.execute(`
      UPDATE \`user_answer_log\` ual
      INNER JOIN \`question\` q ON ual.question_id = q.id
      SET ual.chapter_id = q.chapter_id
      WHERE ual.chapter_id = 0 OR ual.chapter_id IS NULL
    `);
		console.log(`✅ 更新了 ${updateResult.affectedRows} 条记录的 chapter_id`);

		// 显示表结构
		console.log('\n📋 当前表结构:');
		const [structure] = await connection.execute('DESCRIBE `user_answer_log`');
		console.table(structure);

		console.log('\n✅ 迁移完成！');
	} catch (error) {
		console.error('❌ 迁移失败:', error.message);
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

// 检查命令行参数
const isRemote = process.argv.includes('--remote');

if (isRemote) {
	console.log('🌐 远程数据库模式');
} else {
	console.log('💻 本地数据库模式');
}

addChapterIdField(isRemote).catch((error) => {
	console.error('❌ 执行失败:', error);
	process.exit(1);
});

