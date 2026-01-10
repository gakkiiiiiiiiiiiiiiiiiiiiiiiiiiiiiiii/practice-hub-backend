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

async function verifyData() {
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

		// 检查课程数据
		const [courses] = await connection.query('SELECT COUNT(*) as count FROM course');
		const [courseList] = await connection.query('SELECT id, name FROM course ORDER BY id DESC LIMIT 10');
		
		console.log(`课程数据:`);
		console.log(`  总数: ${courses[0].count}`);
		console.log(`  最近10个课程:`);
		courseList.forEach((course) => {
			console.log(`    - ID: ${course.id}, 名称: ${course.name}`);
		});

		// 检查章节数据
		const [chapters] = await connection.query('SELECT COUNT(*) as count FROM chapter');
		const [chapterList] = await connection.query('SELECT id, course_id, name FROM chapter ORDER BY id DESC LIMIT 10');
		
		console.log(`\n章节数据:`);
		console.log(`  总数: ${chapters[0].count}`);
		console.log(`  最近10个章节:`);
		chapterList.forEach((chapter) => {
			console.log(`    - ID: ${chapter.id}, 课程ID: ${chapter.course_id}, 名称: ${chapter.name}`);
		});

		// 检查题目数据
		const [questions] = await connection.query('SELECT COUNT(*) as count FROM question');
		const [questionList] = await connection.query('SELECT id, chapter_id, type FROM question ORDER BY id DESC LIMIT 10');
		
		console.log(`\n题目数据:`);
		console.log(`  总数: ${questions[0].count}`);
		console.log(`  最近10道题目:`);
		questionList.forEach((question) => {
			const typeMap = { 1: '单选', 2: '多选', 3: '判断', 4: '填空', 5: '阅读理解', 6: '简答' };
			console.log(`    - ID: ${question.id}, 章节ID: ${question.chapter_id}, 类型: ${typeMap[question.type] || question.type}`);
		});

		// 检查章节和题目的关联
		const [chapterQuestionCount] = await connection.query(`
			SELECT c.id, c.name, COUNT(q.id) as question_count
			FROM chapter c
			LEFT JOIN question q ON q.chapter_id = c.id
			GROUP BY c.id, c.name
			ORDER BY c.id DESC
			LIMIT 10
		`);

		console.log(`\n章节题目关联:`);
		chapterQuestionCount.forEach((item) => {
			console.log(`    - 章节 ${item.id} (${item.name}): ${item.question_count} 道题目`);
		});

		console.log('\n✅ 数据验证完成！');
	} catch (error) {
		console.error('❌ 验证失败:', error.message);
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

verifyData();
