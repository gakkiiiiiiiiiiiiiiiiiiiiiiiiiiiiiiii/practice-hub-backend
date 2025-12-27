/**
 * 检查远程数据库结构
 * 使用方法：node scripts/check-remote-db.js
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

async function checkRemoteDatabase() {
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
		console.log('检查数据库结构');
		console.log('========================================\n');

		// 检查表
		console.log('1. 检查表结构:');
		const hasSubjectTable = await checkTableExists(connection, 'subject');
		const hasCourseTable = await checkTableExists(connection, 'course');
		const hasUserSubjectAuth = await checkTableExists(connection, 'user_subject_auth');
		const hasUserCourseAuth = await checkTableExists(connection, 'user_course_auth');

		console.log(`  - subject 表: ${hasSubjectTable ? '✅ 存在' : '❌ 不存在'}`);
		console.log(`  - course 表: ${hasCourseTable ? '✅ 存在' : '❌ 不存在'}`);
		console.log(`  - user_subject_auth 表: ${hasUserSubjectAuth ? '⚠️  存在（需要迁移）' : '✅ 不存在'}`);
		console.log(`  - user_course_auth 表: ${hasUserCourseAuth ? '✅ 存在' : '❌ 不存在'}\n`);

		// 检查 course 表字段
		if (hasCourseTable) {
			console.log('2. 检查 course 表字段:');
			const hasSubjectField = await checkColumnExists(connection, 'course', 'subject');
			const hasSchoolField = await checkColumnExists(connection, 'course', 'school');
			const hasMajorField = await checkColumnExists(connection, 'course', 'major');
			const hasExamYearField = await checkColumnExists(connection, 'course', 'exam_year');
			const hasAnswerYearField = await checkColumnExists(connection, 'course', 'answer_year');

			console.log(`  - subject: ${hasSubjectField ? '✅' : '❌'}`);
			console.log(`  - school: ${hasSchoolField ? '✅' : '❌'}`);
			console.log(`  - major: ${hasMajorField ? '✅' : '❌'}`);
			console.log(`  - exam_year: ${hasExamYearField ? '✅' : '❌'}`);
			console.log(`  - answer_year: ${hasAnswerYearField ? '✅' : '❌'}\n`);
		}

		// 检查相关表的字段
		console.log('3. 检查相关表的字段:');
		const tablesToCheck = [
			{ table: 'chapter', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'user_wrong_book', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'order', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'activation_code', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'home_recommend_item', oldCol: 'subject_id', newCol: 'course_id' },
		];

		let needsMigration = false;
		const migrationSteps = [];

		for (const { table, oldCol, newCol } of tablesToCheck) {
			const tableExists = await checkTableExists(connection, table);
			if (!tableExists) {
				console.log(`  - ${table}: ⚠️  表不存在`);
				continue;
			}

			const hasOldCol = await checkColumnExists(connection, table, oldCol);
			const hasNewCol = await checkColumnExists(connection, table, newCol);

			if (hasOldCol && !hasNewCol) {
				console.log(`  - ${table}: ❌ 需要迁移 (${oldCol} -> ${newCol})`);
				needsMigration = true;
				migrationSteps.push(
					`ALTER TABLE \`${table}\` CHANGE \`${oldCol}\` \`${newCol}\` INT NOT NULL COMMENT '课程ID';`
				);
			} else if (hasNewCol && !hasOldCol) {
				console.log(`  - ${table}: ✅ 已迁移`);
			} else if (hasOldCol && hasNewCol) {
				console.log(`  - ${table}: ⚠️  两个字段都存在（需要手动处理）`);
				needsMigration = true;
			} else {
				console.log(`  - ${table}: ⚠️  两个字段都不存在（表可能为空）`);
			}
		}

		// 总结
		console.log('\n========================================');
		console.log('检查结果');
		console.log('========================================\n');

		if (needsMigration || hasSubjectTable || hasUserSubjectAuth) {
			console.log('❌ 数据库需要迁移！\n');
			console.log('需要执行的迁移步骤:\n');

			if (hasSubjectTable && !hasCourseTable) {
				console.log('1. 重命名表:');
				console.log('   ALTER TABLE `subject` RENAME TO `course`;\n');
			}

			if (hasUserSubjectAuth && !hasUserCourseAuth) {
				console.log('2. 重命名表:');
				console.log('   ALTER TABLE `user_subject_auth` RENAME TO `user_course_auth`;\n');
			}

			if (migrationSteps.length > 0) {
				console.log('3. 更新字段名:');
				migrationSteps.forEach((step, index) => {
					console.log(`   ${index + 1}. ${step}`);
				});
				console.log('');
			}

			if (hasCourseTable) {
				const hasSubjectField = await checkColumnExists(connection, 'course', 'subject');
				if (!hasSubjectField) {
					console.log('4. 添加新字段到 course 表:');
					console.log('   ALTER TABLE `course` ADD COLUMN `subject` VARCHAR(100) NULL COMMENT \'科目\' AFTER `name`;');
					console.log('   ALTER TABLE `course` ADD COLUMN `school` VARCHAR(100) NULL COMMENT \'学校\' AFTER `subject`;');
					console.log('   ALTER TABLE `course` ADD COLUMN `major` VARCHAR(100) NULL COMMENT \'专业\' AFTER `school`;');
					console.log('   ALTER TABLE `course` ADD COLUMN `exam_year` VARCHAR(20) NULL COMMENT \'真题年份\' AFTER `major`;');
					console.log('   ALTER TABLE `course` ADD COLUMN `answer_year` VARCHAR(20) NULL COMMENT \'答案年份\' AFTER `exam_year`;\n');
				}
			}

			console.log('或者直接执行迁移脚本:');
			console.log('  npm run migrate\n');
		} else {
			console.log('✅ 数据库结构检查通过！');
			console.log('所有表和字段都已正确迁移。\n');
		}

		// 显示数据统计
		if (hasCourseTable) {
			try {
				const [courseCount] = await connection.query('SELECT COUNT(*) as count FROM course');
				console.log(`数据统计: course 表有 ${courseCount[0].count} 条记录`);
			} catch (e) {
				// 忽略错误
			}
		}
	} catch (error) {
		console.error('\n❌ 检查失败:');
		console.error(error.message);
		console.error('\n请检查数据库连接配置。\n');
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
			console.log('\n数据库连接已关闭');
		}
	}
}

// 执行检查
checkRemoteDatabase();

