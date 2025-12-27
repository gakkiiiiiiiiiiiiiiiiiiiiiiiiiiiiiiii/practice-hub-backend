/**
 * 修复 home_recommend_item 表的字段名
 * 将 subject_id 改为 course_id
 * 使用方法：node scripts/fix-home-recommend-item.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const DB_CONFIG = {
	host: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '3306'),
	user: process.env.DB_USERNAME || 'root',
	password: process.env.DB_PASSWORD || 'root123456',
	database: process.env.DB_DATABASE || 'practice_hub',
	multipleStatements: true,
};

async function checkColumnExists(connection, tableName, columnName) {
	const [rows] = await connection.query(
		`SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		[DB_CONFIG.database, tableName, columnName]
	);
	return rows[0].count > 0;
}

async function fixHomeRecommendItem() {
	let connection;

	try {
		console.log('正在连接数据库...');
		console.log(`数据库: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}\n`);

		connection = await mysql.createConnection(DB_CONFIG);
		console.log('✅ 数据库连接成功\n');

		// 检查字段状态
		const hasSubjectId = await checkColumnExists(connection, 'home_recommend_item', 'subject_id');
		const hasCourseId = await checkColumnExists(connection, 'home_recommend_item', 'course_id');

		console.log('检查 home_recommend_item 表字段:');
		console.log(`  - subject_id: ${hasSubjectId ? '存在' : '不存在'}`);
		console.log(`  - course_id: ${hasCourseId ? '存在' : '不存在'}\n`);

		if (hasSubjectId && !hasCourseId) {
			console.log('正在将 subject_id 重命名为 course_id...');
			await connection.query(
				"ALTER TABLE `home_recommend_item` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID'"
			);
			console.log('✅ 字段重命名成功\n');
		} else if (!hasSubjectId && !hasCourseId) {
			console.log('正在添加 course_id 字段...');
			await connection.query(
				"ALTER TABLE `home_recommend_item` ADD COLUMN `course_id` INT NOT NULL COMMENT '课程ID' AFTER `category_id`"
			);
			console.log('✅ 字段添加成功\n');
		} else if (hasCourseId) {
			console.log('✅ course_id 字段已存在，无需修复\n');
		} else {
			console.log('⚠️  未知状态，请手动检查\n');
		}

		// 验证结果
		const finalHasCourseId = await checkColumnExists(connection, 'home_recommend_item', 'course_id');
		const finalHasSubjectId = await checkColumnExists(connection, 'home_recommend_item', 'subject_id');

		console.log('验证结果:');
		console.log(`  - course_id: ${finalHasCourseId ? '✅ 存在' : '❌ 不存在'}`);
		console.log(`  - subject_id: ${finalHasSubjectId ? '⚠️  仍存在（需要手动处理）' : '✅ 不存在'}\n`);

		if (finalHasCourseId && !finalHasSubjectId) {
			console.log('✅ 修复完成！');
		} else if (finalHasCourseId && finalHasSubjectId) {
			console.log('⚠️  course_id 已存在，但 subject_id 仍存在。');
			console.log('   如果 subject_id 中有数据，请先迁移数据后再删除该字段。');
		} else {
			console.log('❌ 修复失败，请检查错误信息。');
		}
	} catch (error) {
		console.error('\n❌ 修复失败:');
		console.error(error.message);
		console.error('\n请检查错误信息并修复后重试。\n');
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
			console.log('数据库连接已关闭');
		}
	}
}

// 执行修复
fixHomeRecommendItem();

