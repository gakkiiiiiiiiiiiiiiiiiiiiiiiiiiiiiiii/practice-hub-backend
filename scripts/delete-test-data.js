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

// 测试数据的课程名称（用于识别测试数据）
const testCourseNames = [
	'2024年考研英语一真题',
	'2024年考研英语二真题',
	'2023年考研英语一真题',
	'2023年考研英语二真题',
	'2022年考研英语一真题',
	'2024年考研历史学基础真题',
	'2023年考研历史学基础真题',
	'2022年考研历史学基础真题',
	'2024年考研政治理论真题',
	'2023年考研政治理论真题',
	'2022年考研政治理论真题',
];

async function deleteTestData() {
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

		// 查找测试课程
		console.log('查找测试课程...');
		const placeholders = testCourseNames.map(() => '?').join(',');
		const [testCourses] = await connection.query(
			`SELECT id, name FROM course WHERE name IN (${placeholders})`,
			testCourseNames
		);

		if (testCourses.length === 0) {
			console.log('⚠️  未找到测试课程数据');
			await connection.end();
			return;
		}

		console.log(`找到 ${testCourses.length} 个测试课程:`);
		testCourses.forEach((course) => {
			console.log(`  - ID: ${course.id}, 名称: ${course.name}`);
		});

		const courseIds = testCourses.map((c) => c.id);

		// 1. 删除题目（先删除题目，因为题目依赖章节）
		console.log('\n开始删除题目数据...');
		const [questionResult] = await connection.query(
			`DELETE FROM question WHERE chapter_id IN (
				SELECT id FROM chapter WHERE course_id IN (?)
			)`,
			[courseIds]
		);
		console.log(`  ✓ 删除了 ${questionResult.affectedRows} 道题目`);

		// 2. 删除章节
		console.log('\n开始删除章节数据...');
		const [chapterResult] = await connection.query(
			`DELETE FROM chapter WHERE course_id IN (?)`,
			[courseIds]
		);
		console.log(`  ✓ 删除了 ${chapterResult.affectedRows} 个章节`);

		// 3. 删除考试配置（如果存在）
		console.log('\n开始删除考试配置数据...');
		const [examConfigResult] = await connection.query(
			`DELETE FROM exam_config WHERE course_id IN (?)`,
			[courseIds]
		);
		console.log(`  ✓ 删除了 ${examConfigResult.affectedRows} 个考试配置`);

		// 4. 删除课程
		console.log('\n开始删除课程数据...');
		const [courseResult] = await connection.query(
			`DELETE FROM course WHERE id IN (?)`,
			[courseIds]
		);
		console.log(`  ✓ 删除了 ${courseResult.affectedRows} 个课程`);

		// 验证删除结果
		console.log('\n验证删除结果...');
		const [remainingCourses] = await connection.query(
			`SELECT COUNT(*) as count FROM course WHERE name IN (${placeholders})`,
			testCourseNames
		);
		const [remainingChapters] = await connection.query(
			`SELECT COUNT(*) as count FROM chapter WHERE course_id IN (?)`,
			[courseIds.length > 0 ? courseIds : [0]]
		);

		console.log(`  剩余测试课程数: ${remainingCourses[0].count}`);
		console.log(`  剩余关联章节数: ${remainingChapters[0].count}`);

		console.log('\n✅ 测试数据删除完成！');
		console.log(`\n删除统计:`);
		console.log(`  - 删除课程数: ${courseResult.affectedRows}`);
		console.log(`  - 删除章节数: ${chapterResult.affectedRows}`);
		console.log(`  - 删除题目数: ${questionResult.affectedRows}`);
		console.log(`  - 删除考试配置数: ${examConfigResult.affectedRows}`);
	} catch (error) {
		console.error('❌ 删除失败:', error.message);
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

deleteTestData();
