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

async function fixForeignKey() {
	let connection;

	try {
		if (isRemote) {
			const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST;
			const port = parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306');
			const user = process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME;
			const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
			const database = process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub';

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

		// 检查外键约束
		console.log('检查外键约束...');
		const [constraints] = await connection.query(`
			SELECT 
				CONSTRAINT_NAME,
				TABLE_NAME,
				COLUMN_NAME,
				REFERENCED_TABLE_NAME,
				REFERENCED_COLUMN_NAME
			FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'chapter'
			AND REFERENCED_TABLE_NAME IS NOT NULL
		`);

		console.log('当前外键约束:');
		for (const constraint of constraints) {
			console.log(`  - ${constraint.CONSTRAINT_NAME}: ${constraint.TABLE_NAME}.${constraint.COLUMN_NAME} -> ${constraint.REFERENCED_TABLE_NAME}.${constraint.REFERENCED_COLUMN_NAME}`);
		}

		// 删除指向 subject 的外键约束
		for (const constraint of constraints) {
			if (constraint.REFERENCED_TABLE_NAME === 'subject') {
				console.log(`\n删除旧的外键约束: ${constraint.CONSTRAINT_NAME}`);
				try {
					await connection.query(`ALTER TABLE chapter DROP FOREIGN KEY ${constraint.CONSTRAINT_NAME}`);
					console.log(`  ✓ 已删除`);
				} catch (error) {
					if (error.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
						console.log(`  ⚠️  外键不存在，跳过`);
					} else {
						throw error;
					}
				}
			}
		}

		// 检查是否已存在指向 course 的外键
		const [courseConstraints] = await connection.query(`
			SELECT CONSTRAINT_NAME
			FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'chapter'
			AND REFERENCED_TABLE_NAME = 'course'
		`);

		if (courseConstraints.length === 0) {
			// 添加新的外键约束指向 course
			console.log('\n添加新的外键约束指向 course 表...');
			try {
				await connection.query(`
					ALTER TABLE chapter
					ADD CONSTRAINT FK_chapter_course
					FOREIGN KEY (course_id) REFERENCES course(id)
					ON DELETE CASCADE
					ON UPDATE CASCADE
				`);
				console.log('  ✓ 外键约束添加成功');
			} catch (error) {
				if (error.code === 'ER_DUP_KEYNAME') {
					console.log('  ⚠️  外键已存在，跳过');
				} else {
					throw error;
				}
			}
		} else {
			console.log('\n✓ 外键约束已正确指向 course 表');
		}

		console.log('\n✅ 外键约束修复完成！');
	} catch (error) {
		console.error('❌ 修复失败:', error.message);
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

fixForeignKey();
