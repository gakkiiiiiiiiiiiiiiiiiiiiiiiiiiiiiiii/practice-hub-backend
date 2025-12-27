/**
 * 远程数据库迁移脚本
 * 自动检测并修复远程数据库结构
 * 使用方法：node scripts/migrate-remote-db.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// 支持多个环境变量文件
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
const envRemotePath = path.resolve(__dirname, '../.env.remote');

if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}
if (fs.existsSync(envRemotePath)) {
	dotenv.config({ path: envRemotePath, override: true });
	console.log('✓ 已加载环境变量文件: .env.remote');
}

const DB_CONFIG = {
	host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || '3306'),
	user: process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME || 'root',
	password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD || '',
	database: process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub',
	multipleStatements: true,
};

async function checkColumnExists(connection, tableName, columnName) {
	try {
		const [rows] = await connection.query(
			`SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
			[DB_CONFIG.database, tableName, columnName]
		);
		return rows[0].count > 0;
	} catch {
		return false;
	}
}

async function checkTableExists(connection, tableName) {
	try {
		const [rows] = await connection.query(
			`SELECT COUNT(*) as count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
			[DB_CONFIG.database, tableName]
		);
		return rows[0].count > 0;
	} catch {
		return false;
	}
}

async function migrateRemoteDatabase() {
	let connection;

	try {
		console.log('正在连接远程数据库...');
		console.log(`数据库: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
		console.log(`用户: ${DB_CONFIG.user}\n`);

		if (!DB_CONFIG.host || !DB_CONFIG.user || !DB_CONFIG.password) {
			console.error('❌ 错误: 缺少数据库配置');
			console.error('\n请设置以下环境变量:');
			console.error('  REMOTE_DB_HOST=远程数据库地址');
			console.error('  REMOTE_DB_PORT=3306');
			console.error('  REMOTE_DB_USERNAME=用户名');
			console.error('  REMOTE_DB_PASSWORD=密码');
			console.error('  REMOTE_DB_DATABASE=practice_hub');
			console.error('\n或者创建 .env.remote 文件');
			process.exit(1);
		}

		connection = await mysql.createConnection(DB_CONFIG);
		console.log('✅ 数据库连接成功\n');

		console.log('========================================');
		console.log('开始迁移远程数据库');
		console.log('========================================\n');

		// 1. 检查并重命名表
		const hasSubjectTable = await checkTableExists(connection, 'subject');
		const hasCourseTable = await checkTableExists(connection, 'course');
		const hasUserSubjectAuth = await checkTableExists(connection, 'user_subject_auth');
		const hasUserCourseAuth = await checkTableExists(connection, 'user_course_auth');

		if (hasSubjectTable && !hasCourseTable) {
			console.log('1. 重命名 subject 表为 course...');
			await connection.query('ALTER TABLE `subject` RENAME TO `course`');
			console.log('   ✅ subject 表已重命名为 course\n');
		} else if (hasCourseTable) {
			console.log('1. ✅ course 表已存在\n');
		}

		if (hasUserSubjectAuth && !hasUserCourseAuth) {
			console.log('2. 重命名 user_subject_auth 表为 user_course_auth...');
			await connection.query('ALTER TABLE `user_subject_auth` RENAME TO `user_course_auth`');
			console.log('   ✅ user_subject_auth 表已重命名\n');
		} else if (hasUserCourseAuth) {
			console.log('2. ✅ user_course_auth 表已存在\n');
		}

		// 2. 添加新字段到 course 表
		if (hasCourseTable || hasSubjectTable) {
			const tableName = hasCourseTable ? 'course' : 'subject';
			console.log(`3. 检查 ${tableName} 表的新字段...`);

			const hasSubjectField = await checkColumnExists(connection, tableName, 'subject');
			const hasSchoolField = await checkColumnExists(connection, tableName, 'school');
			const hasMajorField = await checkColumnExists(connection, tableName, 'major');
			const hasExamYearField = await checkColumnExists(connection, tableName, 'exam_year');
			const hasAnswerYearField = await checkColumnExists(connection, tableName, 'answer_year');

			if (!hasSubjectField) {
				await connection.query(
					"ALTER TABLE `course` ADD COLUMN `subject` VARCHAR(100) NULL COMMENT '科目（如：数学、英语、政治等）' AFTER `name`"
				);
				console.log('   ✅ 已添加 subject 字段');
			}
			if (!hasSchoolField) {
				await connection.query(
					"ALTER TABLE `course` ADD COLUMN `school` VARCHAR(100) NULL COMMENT '学校（如：北京大学、清华大学等）' AFTER `subject`"
				);
				console.log('   ✅ 已添加 school 字段');
			}
			if (!hasMajorField) {
				await connection.query(
					"ALTER TABLE `course` ADD COLUMN `major` VARCHAR(100) NULL COMMENT '专业（如：计算机科学与技术、软件工程等）' AFTER `school`"
				);
				console.log('   ✅ 已添加 major 字段');
			}
			if (!hasExamYearField) {
				await connection.query(
					"ALTER TABLE `course` ADD COLUMN `exam_year` VARCHAR(20) NULL COMMENT '真题年份（如：2024、2023等）' AFTER `major`"
				);
				console.log('   ✅ 已添加 exam_year 字段');
			}
			if (!hasAnswerYearField) {
				await connection.query(
					"ALTER TABLE `course` ADD COLUMN `answer_year` VARCHAR(20) NULL COMMENT '答案年份（如：2024、2023等）' AFTER `exam_year`"
				);
				console.log('   ✅ 已添加 answer_year 字段');
			}

			if (hasSubjectField && hasSchoolField && hasMajorField && hasExamYearField && hasAnswerYearField) {
				console.log('   ✅ 所有新字段已存在');
			}
			console.log('');
		}

		// 3. 更新相关表的字段名
		console.log('4. 更新相关表的字段名...');
		const tablesToCheck = [
			{ table: 'chapter', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'user_wrong_book', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'order', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'activation_code', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'home_recommend_item', oldCol: 'subject_id', newCol: 'course_id' },
		];

		if (hasUserSubjectAuth && !hasUserCourseAuth) {
			tablesToCheck.push({ table: 'user_subject_auth', oldCol: 'subject_id', newCol: 'course_id' });
		} else {
			tablesToCheck.push({ table: 'user_course_auth', oldCol: 'subject_id', newCol: 'course_id' });
		}

		for (const { table, oldCol, newCol } of tablesToCheck) {
			const tableExists = await checkTableExists(connection, table);
			if (!tableExists) {
				console.log(`   ⚠️  ${table} 表不存在，跳过`);
				continue;
			}

			const hasOldCol = await checkColumnExists(connection, table, oldCol);
			const hasNewCol = await checkColumnExists(connection, table, newCol);

			if (hasOldCol && !hasNewCol) {
				console.log(`   正在更新 ${table} 表: ${oldCol} -> ${newCol}...`);
				try {
					await connection.query(
						`ALTER TABLE \`${table}\` CHANGE \`${oldCol}\` \`${newCol}\` INT NOT NULL COMMENT '课程ID'`
					);
					console.log(`   ✅ ${table} 表已更新`);
				} catch (error) {
					console.error(`   ❌ ${table} 表更新失败: ${error.message}`);
				}
			} else if (hasNewCol) {
				console.log(`   ✅ ${table} 表已使用 ${newCol}`);
			} else if (!hasOldCol && !hasNewCol) {
				console.log(`   ⚠️  ${table} 表没有 ${oldCol} 或 ${newCol} 字段（可能表为空）`);
			}
		}

		console.log('\n========================================');
		console.log('迁移完成！');
		console.log('========================================\n');

		// 验证结果
		console.log('验证迁移结果...\n');

		const finalHasCourseTable = await checkTableExists(connection, 'course');
		const finalHasUserCourseAuth = await checkTableExists(connection, 'user_course_auth');
		const finalChapterHasCourseId = await checkColumnExists(connection, 'chapter', 'course_id');
		const finalHomeRecommendHasCourseId = await checkColumnExists(connection, 'home_recommend_item', 'course_id');

		console.log(`  - course 表: ${finalHasCourseTable ? '✅' : '❌'}`);
		console.log(`  - user_course_auth 表: ${finalHasUserCourseAuth ? '✅' : '❌'}`);
		console.log(`  - chapter.course_id: ${finalChapterHasCourseId ? '✅' : '❌'}`);
		console.log(`  - home_recommend_item.course_id: ${finalHomeRecommendHasCourseId ? '✅' : '❌'}\n`);

		if (finalHasCourseTable && finalHasUserCourseAuth && finalChapterHasCourseId && finalHomeRecommendHasCourseId) {
			console.log('✅ 所有迁移检查通过！');
			console.log('现在可以执行数据导入了：npm run import:remote\n');
		} else {
			console.log('⚠️  部分迁移可能未完成，请检查上述结果。\n');
		}
	} catch (error) {
		console.error('\n❌ 迁移失败:');
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

// 执行迁移
migrateRemoteDatabase();

