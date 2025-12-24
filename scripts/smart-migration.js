/**
 * 智能数据库迁移脚本
 * 自动检测数据库状态，只执行必要的迁移操作
 * 使用方法：node scripts/smart-migration.js
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
	multipleStatements: true,
};

async function checkTableExists(connection, tableName) {
	const [rows] = await connection.query(
		`SELECT COUNT(*) as count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
		[DB_CONFIG.database, tableName]
	);
	return rows[0].count > 0;
}

async function checkColumnExists(connection, tableName, columnName) {
	const [rows] = await connection.query(
		`SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		[DB_CONFIG.database, tableName, columnName]
	);
	return rows[0].count > 0;
}

async function runSmartMigration() {
	let connection;

	try {
		console.log('正在连接数据库...');
		console.log(`数据库: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}\n`);

		connection = await mysql.createConnection(DB_CONFIG);
		console.log('✅ 数据库连接成功\n');

		// 检查当前状态
		console.log('检查数据库当前状态...\n');

		const hasSubjectTable = await checkTableExists(connection, 'subject');
		const hasCourseTable = await checkTableExists(connection, 'course');
		const hasUserSubjectAuth = await checkTableExists(connection, 'user_subject_auth');
		const hasUserCourseAuth = await checkTableExists(connection, 'user_course_auth');

		console.log(`  - subject 表: ${hasSubjectTable ? '存在' : '不存在'}`);
		console.log(`  - course 表: ${hasCourseTable ? '存在' : '不存在'}`);
		console.log(`  - user_subject_auth 表: ${hasUserSubjectAuth ? '存在' : '不存在'}`);
		console.log(`  - user_course_auth 表: ${hasUserCourseAuth ? '存在' : '不存在'}\n`);

		// 如果 course 表已经存在，检查字段
		if (hasCourseTable) {
			const hasSubjectField = await checkColumnExists(connection, 'course', 'subject');
			const hasSchoolField = await checkColumnExists(connection, 'course', 'school');
			const hasMajorField = await checkColumnExists(connection, 'course', 'major');
			const hasExamYearField = await checkColumnExists(connection, 'course', 'exam_year');
			const hasAnswerYearField = await checkColumnExists(connection, 'course', 'answer_year');

			console.log('course 表字段检查:');
			console.log(`  - subject: ${hasSubjectField ? '存在' : '不存在'}`);
			console.log(`  - school: ${hasSchoolField ? '存在' : '不存在'}`);
			console.log(`  - major: ${hasMajorField ? '存在' : '不存在'}`);
			console.log(`  - exam_year: ${hasExamYearField ? '存在' : '不存在'}`);
			console.log(`  - answer_year: ${hasAnswerYearField ? '存在' : '不存在'}\n`);

			// 检查相关表是否已使用 course_id
			const chapterHasCourseId = await checkColumnExists(connection, 'chapter', 'course_id');
			const chapterHasSubjectId = await checkColumnExists(connection, 'chapter', 'subject_id');

			console.log('chapter 表字段检查:');
			console.log(`  - course_id: ${chapterHasCourseId ? '存在' : '不存在'}`);
			console.log(`  - subject_id: ${chapterHasSubjectId ? '存在' : '不存在'}\n`);

			// 判断迁移状态
			if (
				hasCourseTable &&
				hasSubjectField &&
				hasSchoolField &&
				hasMajorField &&
				hasExamYearField &&
				hasAnswerYearField &&
				chapterHasCourseId &&
				!chapterHasSubjectId &&
				hasUserCourseAuth &&
				!hasUserSubjectAuth
			) {
				console.log('✅ 数据库已经完成迁移！');
				console.log('所有必要的表和字段都已存在，无需执行迁移。\n');
				return;
			}
		}

		// 如果 subject 表不存在，但 course 表存在，说明可能已经迁移过了
		if (!hasSubjectTable && hasCourseTable) {
			console.log('⚠️  检测到 course 表已存在，但 subject 表不存在。');
			console.log('这可能意味着数据库已经迁移过了，或者数据库是新建的。\n');

			// 检查是否需要补充字段
			const needsFields = [];
			if (!(await checkColumnExists(connection, 'course', 'subject'))) needsFields.push('subject');
			if (!(await checkColumnExists(connection, 'course', 'school'))) needsFields.push('school');
			if (!(await checkColumnExists(connection, 'course', 'major'))) needsFields.push('major');
			if (!(await checkColumnExists(connection, 'course', 'exam_year'))) needsFields.push('exam_year');
			if (!(await checkColumnExists(connection, 'course', 'answer_year'))) needsFields.push('answer_year');

			if (needsFields.length > 0) {
				console.log(`需要添加字段: ${needsFields.join(', ')}\n`);
				console.log('执行补充迁移...\n');

				// 添加缺失的字段
				if (needsFields.includes('subject')) {
					await connection.query(
						"ALTER TABLE `course` ADD COLUMN `subject` VARCHAR(100) NULL COMMENT '科目（如：数学、英语、政治等）' AFTER `name`"
					);
					console.log('✅ 已添加 subject 字段');
				}
				if (needsFields.includes('school')) {
					await connection.query(
						"ALTER TABLE `course` ADD COLUMN `school` VARCHAR(100) NULL COMMENT '学校（如：北京大学、清华大学等）' AFTER `subject`"
					);
					console.log('✅ 已添加 school 字段');
				}
				if (needsFields.includes('major')) {
					await connection.query(
						"ALTER TABLE `course` ADD COLUMN `major` VARCHAR(100) NULL COMMENT '专业（如：计算机科学与技术、软件工程等）' AFTER `school`"
					);
					console.log('✅ 已添加 major 字段');
				}
				if (needsFields.includes('exam_year')) {
					await connection.query(
						"ALTER TABLE `course` ADD COLUMN `exam_year` VARCHAR(20) NULL COMMENT '真题年份（如：2024、2023等）' AFTER `major`"
					);
					console.log('✅ 已添加 exam_year 字段');
				}
				if (needsFields.includes('answer_year')) {
					await connection.query(
						"ALTER TABLE `course` ADD COLUMN `answer_year` VARCHAR(20) NULL COMMENT '答案年份（如：2024、2023等）' AFTER `exam_year`"
					);
					console.log('✅ 已添加 answer_year 字段');
				}

				console.log('\n✅ 补充迁移完成！\n');
			} else {
				console.log('✅ 所有字段都已存在，无需补充迁移。\n');
			}

			// 检查并更新相关表的字段名
			const tablesToCheck = [
				{ table: 'chapter', oldCol: 'subject_id', newCol: 'course_id' },
				{ table: 'user_wrong_book', oldCol: 'subject_id', newCol: 'course_id' },
				{ table: 'order', oldCol: 'subject_id', newCol: 'course_id' },
				{ table: 'activation_code', oldCol: 'subject_id', newCol: 'course_id' },
				{ table: 'home_recommend_item', oldCol: 'subject_id', newCol: 'course_id' },
			];

			for (const { table, oldCol, newCol } of tablesToCheck) {
				const hasOldCol = await checkColumnExists(connection, table, oldCol);
				const hasNewCol = await checkColumnExists(connection, table, newCol);

				if (hasOldCol && !hasNewCol) {
					console.log(`更新 ${table} 表: ${oldCol} -> ${newCol}...`);
					await connection.query(
						`ALTER TABLE \`${table}\` CHANGE \`${oldCol}\` \`${newCol}\` INT NOT NULL COMMENT '课程ID'`
					);
					console.log(`✅ ${table} 表已更新`);
				} else if (hasNewCol) {
					console.log(`✅ ${table} 表已使用 ${newCol}`);
				}
			}

			// 检查 user_subject_auth 是否需要重命名
			if (hasUserSubjectAuth && !hasUserCourseAuth) {
				console.log('\n重命名 user_subject_auth 表...');
				await connection.query('ALTER TABLE `user_subject_auth` RENAME TO `user_course_auth`');
				console.log('✅ 表已重命名');

				// 更新字段名
				if (await checkColumnExists(connection, 'user_course_auth', 'subject_id')) {
					await connection.query(
						"ALTER TABLE `user_course_auth` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID'"
					);
					console.log('✅ user_course_auth 表字段已更新');
				}
			}

			console.log('\n✅ 智能迁移完成！');
			return;
		}

		// 如果 subject 表存在，执行完整迁移
		if (hasSubjectTable) {
			console.log('检测到 subject 表，执行完整迁移...\n');
			console.log('⚠️  警告：即将执行数据库迁移！');
			console.log('⚠️  请确保已经备份数据库！\n');

			const migrationFile = path.join(__dirname, '../migrations/migrate_subject_to_course.sql');
			if (!fs.existsSync(migrationFile)) {
				throw new Error(`迁移文件不存在: ${migrationFile}`);
			}

			const sql = fs.readFileSync(migrationFile, 'utf8');
			await connection.query(sql);
			console.log('✅ 完整迁移执行完成\n');
		}

		// 验证迁移结果
		console.log('验证迁移结果...\n');

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
runSmartMigration();

