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

// 考研相关课程数据
const courses = [
	// 英语相关
	{
		name: '2024年考研英语一真题',
		subject: '英语',
		school: '北京大学',
		major: '英语语言文学',
		exam_year: '2024',
		answer_year: '2024',
		price: 39.9,
		is_vip_free: 0,
		sort: 1,
	},
	{
		name: '2024年考研英语二真题',
		subject: '英语',
		school: '清华大学',
		major: '翻译硕士',
		exam_year: '2024',
		answer_year: '2024',
		price: 35.9,
		is_vip_free: 0,
		sort: 2,
	},
	{
		name: '2023年考研英语一真题',
		subject: '英语',
		school: '北京外国语大学',
		major: '英语语言文学',
		exam_year: '2023',
		answer_year: '2023',
		price: 34.9,
		is_vip_free: 0,
		sort: 3,
	},
	{
		name: '2023年考研英语二真题',
		subject: '英语',
		school: '上海外国语大学',
		major: '翻译硕士',
		exam_year: '2023',
		answer_year: '2023',
		price: 32.9,
		is_vip_free: 0,
		sort: 4,
	},
	{
		name: '2022年考研英语一真题',
		subject: '英语',
		school: '北京师范大学',
		major: '英语语言文学',
		exam_year: '2022',
		answer_year: '2022',
		price: 29.9,
		is_vip_free: 1,
		sort: 5,
	},
	// 历史相关
	{
		name: '2024年考研历史学基础真题',
		subject: '历史',
		school: '北京大学',
		major: '中国史',
		exam_year: '2024',
		answer_year: '2024',
		price: 45.9,
		is_vip_free: 0,
		sort: 6,
	},
	{
		name: '2024年考研历史学基础真题',
		subject: '历史',
		school: '复旦大学',
		major: '世界史',
		exam_year: '2024',
		answer_year: '2024',
		price: 45.9,
		is_vip_free: 0,
		sort: 7,
	},
	{
		name: '2023年考研历史学基础真题',
		subject: '历史',
		school: '北京师范大学',
		major: '中国史',
		exam_year: '2023',
		answer_year: '2023',
		price: 42.9,
		is_vip_free: 0,
		sort: 8,
	},
	{
		name: '2023年考研历史学基础真题',
		subject: '历史',
		school: '华东师范大学',
		major: '世界史',
		exam_year: '2023',
		answer_year: '2023',
		price: 42.9,
		is_vip_free: 0,
		sort: 9,
	},
	{
		name: '2022年考研历史学基础真题',
		subject: '历史',
		school: '中国人民大学',
		major: '中国史',
		exam_year: '2022',
		answer_year: '2022',
		price: 39.9,
		is_vip_free: 1,
		sort: 10,
	},
	// 政治相关
	{
		name: '2024年考研政治理论真题',
		subject: '政治',
		school: '北京大学',
		major: '马克思主义理论',
		exam_year: '2024',
		answer_year: '2024',
		price: 32.9,
		is_vip_free: 0,
		sort: 11,
	},
	{
		name: '2024年考研政治理论真题',
		subject: '政治',
		school: '清华大学',
		major: '思想政治教育',
		exam_year: '2024',
		answer_year: '2024',
		price: 32.9,
		is_vip_free: 0,
		sort: 12,
	},
	{
		name: '2023年考研政治理论真题',
		subject: '政治',
		school: '中国人民大学',
		major: '马克思主义理论',
		exam_year: '2023',
		answer_year: '2023',
		price: 29.9,
		is_vip_free: 0,
		sort: 13,
	},
	{
		name: '2023年考研政治理论真题',
		subject: '政治',
		school: '北京师范大学',
		major: '思想政治教育',
		exam_year: '2023',
		answer_year: '2023',
		price: 29.9,
		is_vip_free: 0,
		sort: 14,
	},
	{
		name: '2022年考研政治理论真题',
		subject: '政治',
		school: '复旦大学',
		major: '马克思主义理论',
		exam_year: '2022',
		answer_year: '2022',
		price: 27.9,
		is_vip_free: 1,
		sort: 15,
	},
];

// 章节模板（根据课程类型生成不同的章节）
function getChapterTemplates(course) {
	const year = course.exam_year;
	const subject = course.subject;

	if (subject === '英语') {
		return [
			{ name: `${year}年真题`, type: 'year', is_free: 0, sort: 1 },
			{ name: '词汇专项', type: 'chapter', is_free: 1, sort: 2 },
			{ name: '阅读理解', type: 'chapter', is_free: 0, sort: 3 },
			{ name: '完形填空', type: 'chapter', is_free: 0, sort: 4 },
			{ name: '翻译专项', type: 'chapter', is_free: 0, sort: 5 },
			{ name: '写作训练', type: 'chapter', is_free: 0, sort: 6 },
		];
	} else if (subject === '历史') {
		return [
			{ name: `${year}年真题`, type: 'year', is_free: 0, sort: 1 },
			{ name: '中国古代史', type: 'chapter', is_free: 1, sort: 2 },
			{ name: '中国近现代史', type: 'chapter', is_free: 0, sort: 3 },
			{ name: '世界古代史', type: 'chapter', is_free: 0, sort: 4 },
			{ name: '世界近现代史', type: 'chapter', is_free: 0, sort: 5 },
			{ name: '史学理论与方法', type: 'chapter', is_free: 0, sort: 6 },
		];
	} else if (subject === '政治') {
		return [
			{ name: `${year}年真题`, type: 'year', is_free: 0, sort: 1 },
			{ name: '马克思主义基本原理', type: 'chapter', is_free: 1, sort: 2 },
			{ name: '毛泽东思想和中国特色社会主义', type: 'chapter', is_free: 0, sort: 3 },
			{ name: '中国近现代史纲要', type: 'chapter', is_free: 0, sort: 4 },
			{ name: '思想道德与法治', type: 'chapter', is_free: 0, sort: 5 },
			{ name: '当代世界经济与政治', type: 'chapter', is_free: 0, sort: 6 },
		];
	}

	// 默认章节模板
	return [
		{ name: `${year}年真题`, type: 'year', is_free: 0, sort: 1 },
		{ name: '基础知识', type: 'chapter', is_free: 1, sort: 2 },
		{ name: '专项训练', type: 'chapter', is_free: 0, sort: 3 },
	];
}

// 生成题目选项
function generateOptions(type) {
	if (type === 1) {
		// 单选题：A, B, C, D
		return [
			{ label: 'A', text: '选项A' },
			{ label: 'B', text: '选项B' },
			{ label: 'C', text: '选项C' },
			{ label: 'D', text: '选项D' },
		];
	} else if (type === 2) {
		// 多选题：A, B, C, D, E
		return [
			{ label: 'A', text: '选项A' },
			{ label: 'B', text: '选项B' },
			{ label: 'C', text: '选项C' },
			{ label: 'D', text: '选项D' },
			{ label: 'E', text: '选项E' },
		];
	} else if (type === 3) {
		// 判断题：A(正确), B(错误)
		return [
			{ label: 'A', text: '正确' },
			{ label: 'B', text: '错误' },
		];
	}
	return [];
}

// 生成题目答案
function generateAnswer(type) {
	if (type === 1) {
		// 单选题：随机选一个
		const answers = ['A', 'B', 'C', 'D'];
		return [answers[Math.floor(Math.random() * answers.length)]];
	} else if (type === 2) {
		// 多选题：随机选2-3个
		const answers = ['A', 'B', 'C', 'D', 'E'];
		const count = Math.floor(Math.random() * 2) + 2; // 2或3个
		const selected = answers.sort(() => Math.random() - 0.5).slice(0, count);
		return selected.sort();
	} else if (type === 3) {
		// 判断题：随机选A或B
		return Math.random() > 0.5 ? ['A'] : ['B'];
	}
	return [];
}

// 真实的题目内容模板
const questionTemplates = {
	英语: {
		词汇专项: [
			{
				stem: 'The word "ubiquitous" most closely means:',
				options: ['rare', 'everywhere', 'ancient', 'modern'],
				answer: ['B'],
				analysis: '"Ubiquitous" means present, appearing, or found everywhere. 正确答案是B。',
			},
			{
				stem: 'Which of the following words is a synonym for "elaborate"?',
				options: ['simple', 'complex', 'brief', 'quick'],
				answer: ['B'],
				analysis:
					'"Elaborate" means involving many carefully arranged parts or details; detailed and complicated. 正确答案是B。',
			},
			{
				stem: 'The prefix "un-" in "unhappy" means:',
				options: ['very', 'not', 'again', 'before'],
				answer: ['B'],
				analysis: 'The prefix "un-" means not or opposite of. "Unhappy" means not happy. 正确答案是B。',
			},
			{
				stem: 'Choose the word that best completes: "She was _____ about her future plans."',
				options: ['ambiguous', 'ambitious', 'ambient', 'ambivalent'],
				answer: ['B'],
				analysis: '"Ambitious" means having or showing a strong desire and determination to succeed. 正确答案是B。',
			},
			{
				stem: 'The word "ephemeral" means:',
				options: ['permanent', 'temporary', 'eternal', 'lasting'],
				answer: ['B'],
				analysis: '"Ephemeral" means lasting for a very short time. 正确答案是B。',
			},
		],
		阅读理解: [
			{
				stem: 'According to the passage, what is the main idea?',
				options: [
					'Technology is harmful',
					'Education is important',
					'Reading improves vocabulary',
					'Exercise is necessary',
				],
				answer: ['C'],
				analysis:
					'The passage emphasizes that reading extensively helps improve vocabulary and language skills. 正确答案是C。',
			},
			{
				stem: "What can be inferred from the passage about the author's attitude?",
				options: ['Negative', 'Positive', 'Neutral', 'Uncertain'],
				answer: ['B'],
				analysis:
					'The author uses positive language and examples throughout the passage, indicating a positive attitude. 正确答案是B。',
			},
			{
				stem: 'The word "it" in paragraph 2 refers to:',
				options: ['the book', 'the concept', 'the method', 'the result'],
				answer: ['A'],
				analysis: 'Based on the context, "it" refers to the book mentioned in the previous sentence. 正确答案是A。',
			},
		],
		完形填空: [
			{
				stem: 'Choose the best word: "The students were _____ to learn about the new discovery."',
				options: ['eager', 'reluctant', 'afraid', 'angry'],
				answer: ['A'],
				analysis: '"Eager" means wanting to do or have something very much. 正确答案是A。',
			},
			{
				stem: 'Fill in the blank: "She _____ her homework before dinner."',
				options: ['finished', 'will finish', 'finishes', 'is finishing'],
				answer: ['A'],
				analysis: 'Past tense is needed here as the action happened before dinner. 正确答案是A。',
			},
		],
		翻译专项: [
			{
				stem: 'Translate: "The early bird catches the worm."',
				options: ['早起的鸟儿有虫吃', '早起的鸟儿没虫吃', '晚起的鸟儿有虫吃', '鸟儿早起抓虫子'],
				answer: ['A'],
				analysis: 'This is a common English proverb meaning that those who act early will succeed. 正确答案是A。',
			},
			{
				stem: 'Translate: "Practice makes perfect."',
				options: ['练习使人完美', '完美需要练习', '熟能生巧', '练习很重要'],
				answer: ['C'],
				analysis: 'This proverb means that repeated practice leads to improvement. 正确答案是C。',
			},
		],
		写作训练: [
			{
				stem: 'Which sentence is grammatically correct?',
				options: ["He don't like it", "He doesn't like it", 'He not like it', 'He no like it'],
				answer: ['B'],
				analysis: 'Third person singular requires "doesn\'t" not "don\'t". 正确答案是B。',
			},
			{
				stem: 'Choose the best topic sentence for a paragraph about environmental protection:',
				options: [
					'Many people like nature',
					'Environmental protection is crucial for our future',
					'Some animals are cute',
					'Weather changes often',
				],
				answer: ['B'],
				analysis: 'A topic sentence should introduce the main idea of the paragraph. 正确答案是B。',
			},
		],
	},
	历史: {
		中国古代史: [
			{
				stem: '中国历史上第一个统一的封建王朝是：',
				options: ['夏朝', '商朝', '秦朝', '汉朝'],
				answer: ['C'],
				analysis: '秦始皇于公元前221年统一六国，建立了中国历史上第一个统一的封建王朝——秦朝。正确答案是C。',
			},
			{
				stem: '"罢黜百家，独尊儒术"是哪位皇帝的政策？',
				options: ['秦始皇', '汉武帝', '唐太宗', '宋太祖'],
				answer: ['B'],
				analysis: '汉武帝采纳董仲舒的建议，实行"罢黜百家，独尊儒术"的政策，确立了儒家思想的统治地位。正确答案是B。',
			},
			{
				stem: '唐朝的"开元盛世"出现在哪位皇帝统治时期？',
				options: ['唐太宗', '唐高宗', '唐玄宗', '唐肃宗'],
				answer: ['C'],
				analysis: '唐玄宗李隆基在位前期，政治清明，经济繁荣，史称"开元盛世"。正确答案是C。',
			},
			{
				stem: '下列哪个朝代不是由少数民族建立的？',
				options: ['元朝', '清朝', '明朝', '辽朝'],
				answer: ['C'],
				analysis: '明朝是由汉族建立的，元朝是蒙古族，清朝是满族，辽朝是契丹族。正确答案是C。',
			},
		],
		中国近现代史: [
			{
				stem: '鸦片战争爆发于哪一年？',
				options: ['1839年', '1840年', '1842年', '1856年'],
				answer: ['B'],
				analysis: '第一次鸦片战争爆发于1840年，标志着中国近代史的开端。正确答案是B。',
			},
			{
				stem: '辛亥革命推翻了哪个王朝？',
				options: ['明朝', '清朝', '元朝', '宋朝'],
				answer: ['B'],
				analysis: '1911年辛亥革命推翻了清朝的统治，结束了中国两千多年的封建帝制。正确答案是B。',
			},
			{
				stem: '五四运动爆发于哪一年？',
				options: ['1917年', '1918年', '1919年', '1920年'],
				answer: ['C'],
				analysis: '五四运动爆发于1919年5月4日，是中国新民主主义革命的开端。正确答案是C。',
			},
		],
		世界古代史: [
			{
				stem: '古埃及文明发源于：',
				options: ['尼罗河流域', '两河流域', '印度河流域', '黄河流域'],
				answer: ['A'],
				analysis: '古埃及文明发源于尼罗河流域，尼罗河的定期泛滥为农业生产提供了条件。正确答案是A。',
			},
			{
				stem: '古希腊的"民主政治"最早出现在哪个城邦？',
				options: ['斯巴达', '雅典', '科林斯', '底比斯'],
				answer: ['B'],
				analysis: '雅典是古希腊民主政治的摇篮，伯里克利时期达到鼎盛。正确答案是B。',
			},
		],
		世界近现代史: [
			{
				stem: '第一次世界大战爆发于哪一年？',
				options: ['1913年', '1914年', '1915年', '1916年'],
				answer: ['B'],
				analysis: '第一次世界大战于1914年7月28日爆发，1918年11月11日结束。正确答案是B。',
			},
			{
				stem: '第二次世界大战的转折点是：',
				options: ['珍珠港事件', '斯大林格勒战役', '诺曼底登陆', '柏林战役'],
				answer: ['B'],
				analysis: '斯大林格勒战役是二战的转折点，标志着德军开始走向失败。正确答案是B。',
			},
		],
		史学理论与方法: [
			{
				stem: '历史研究的基本方法是：',
				options: ['文献研究法', '考古研究法', '口述历史法', '以上都是'],
				answer: ['D'],
				analysis: '历史研究需要综合运用多种方法，包括文献研究、考古发掘、口述历史等。正确答案是D。',
			},
		],
	},
	政治: {
		马克思主义基本原理: [
			{
				stem: '马克思主义哲学的根本特征是：',
				options: ['科学性', '实践性', '革命性', '以上都是'],
				answer: ['D'],
				analysis: '马克思主义哲学具有科学性、实践性和革命性的统一特征。正确答案是D。',
			},
			{
				stem: '唯物辩证法的核心是：',
				options: ['对立统一规律', '质量互变规律', '否定之否定规律', '联系和发展'],
				answer: ['A'],
				analysis: '对立统一规律是唯物辩证法的实质和核心。正确答案是A。',
			},
			{
				stem: '社会存在决定社会意识，这是：',
				options: ['唯心主义观点', '唯物主义观点', '形而上学观点', '不可知论观点'],
				answer: ['B'],
				analysis: '社会存在决定社会意识是历史唯物主义的基本观点。正确答案是B。',
			},
		],
		毛泽东思想和中国特色社会主义: [
			{
				stem: '毛泽东思想活的灵魂是：',
				options: [
					'实事求是、群众路线、独立自主',
					'解放思想、实事求是、与时俱进',
					'理论联系实际、密切联系群众、批评与自我批评',
					'以上都不是',
				],
				answer: ['A'],
				analysis: '毛泽东思想活的灵魂包括实事求是、群众路线、独立自主三个方面。正确答案是A。',
			},
			{
				stem: '中国特色社会主义理论体系的开创者是：',
				options: ['毛泽东', '邓小平', '江泽民', '胡锦涛'],
				answer: ['B'],
				analysis: '邓小平理论是中国特色社会主义理论体系的开创之作。正确答案是B。',
			},
		],
		中国近现代史纲要: [
			{
				stem: '中国共产党的成立时间是：',
				options: ['1919年', '1920年', '1921年', '1922年'],
				answer: ['C'],
				analysis: '中国共产党成立于1921年7月，标志着中国革命进入新阶段。正确答案是C。',
			},
			{
				stem: '中华人民共和国成立的时间是：',
				options: ['1948年10月1日', '1949年10月1日', '1950年10月1日', '1951年10月1日'],
				answer: ['B'],
				analysis: '1949年10月1日，中华人民共和国成立，标志着新民主主义革命的胜利。正确答案是B。',
			},
		],
		思想道德与法治: [
			{
				stem: '社会主义核心价值观的基本内容是：',
				options: ['富强、民主、文明、和谐', '自由、平等、公正、法治', '爱国、敬业、诚信、友善', '以上都是'],
				answer: ['D'],
				analysis: '社会主义核心价值观包括国家、社会、个人三个层面的价值要求。正确答案是D。',
			},
		],
		当代世界经济与政治: [
			{
				stem: '当今时代的主题是：',
				options: ['战争与革命', '和平与发展', '对抗与冲突', '竞争与合作'],
				answer: ['B'],
				analysis: '和平与发展是当今时代的主题，这是对国际形势的科学判断。正确答案是B。',
			},
		],
	},
};

// 生成题目
function generateQuestions(chapterId, chapterName, subject, count = 20) {
	const questions = [];
	const types = [1, 2, 3]; // 单选、多选、判断

	// 获取该章节的题目模板
	let templates = [];
	if (questionTemplates[subject] && questionTemplates[subject][chapterName]) {
		templates = questionTemplates[subject][chapterName];
	}

	// 如果模板不足，生成通用题目
	for (let i = 1; i <= count; i++) {
		const type = types[Math.floor(Math.random() * types.length)];
		const difficulty = Math.floor(Math.random() * 3) + 1; // 1-3

		let stem, options, answer, analysis;

		// 如果有模板且未用完，使用模板
		if (templates.length > 0 && i <= templates.length) {
			const template = templates[i - 1];
			stem = template.stem;
			options = template.options.map((opt, idx) => ({ label: String.fromCharCode(65 + idx), text: opt }));
			answer = template.answer;
			analysis = template.analysis;
		} else {
			// 生成通用题目
			stem = `关于${chapterName}的相关知识，请选择正确答案。`;
			options = generateOptions(type);
			answer = generateAnswer(type);
			analysis = `本题考查${chapterName}的相关知识点。正确答案是${answer.join('、')}。`;
		}

		questions.push({
			chapter_id: chapterId,
			parent_id: 0,
			type: type,
			stem: stem,
			options: JSON.stringify(options),
			answer: JSON.stringify(answer),
			analysis: analysis,
			difficulty: difficulty,
		});
	}

	return questions;
}

async function insertTestData() {
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

		// 1. 插入课程
		console.log('开始插入课程数据...');
		const courseIds = [];

		for (const course of courses) {
			const [result] = await connection.query(
				`INSERT INTO course (name, subject, school, major, exam_year, answer_year, price, is_vip_free, sort, create_time, update_time)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
				[
					course.name,
					course.subject,
					course.school,
					course.major,
					course.exam_year,
					course.answer_year,
					course.price,
					course.is_vip_free,
					course.sort,
				]
			);

			courseIds.push(result.insertId);
			console.log(`  ✓ 插入课程: ${course.name} (ID: ${result.insertId})`);
		}

		console.log(`\n✓ 共插入 ${courseIds.length} 个课程\n`);

		// 2. 插入章节
		console.log('开始插入章节数据...');
		const chapterIds = [];

		for (let i = 0; i < courseIds.length; i++) {
			const courseId = courseIds[i];
			const course = courses[i];
			const templates = getChapterTemplates(course);

			for (const template of templates) {
				const [result] = await connection.query(
					`INSERT INTO chapter (course_id, name, type, is_free, sort, create_time, update_time)
					VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
					[courseId, template.name, template.type, template.is_free, template.sort]
				);

				chapterIds.push(result.insertId);
				console.log(`  ✓ 插入章节: ${template.name} (课程ID: ${courseId}, 章节ID: ${result.insertId})`);
			}
		}

		console.log(`\n✓ 共插入 ${chapterIds.length} 个章节\n`);

		// 3. 插入题目
		console.log('开始插入题目数据...');
		let questionCount = 0;

		// 根据章节类型生成不同数量的题目
		for (let i = 0; i < chapterIds.length; i++) {
			const chapterId = chapterIds[i];
			// 查找章节信息和课程信息
			const [chapterInfo] = await connection.query(
				`SELECT c.name, c.type, co.subject 
				FROM chapter c 
				JOIN course co ON c.course_id = co.id 
				WHERE c.id = ?`,
				[chapterId]
			);

			let questionCountPerChapter = 20; // 默认20道
			if (chapterInfo[0] && chapterInfo[0].type === 'year') {
				// 真题章节题目多一些
				questionCountPerChapter = 30;
			}

			const chapterName = chapterInfo[0]?.name || '';
			const subject = chapterInfo[0]?.subject || '';
			const questions = generateQuestions(chapterId, chapterName, subject, questionCountPerChapter);

			try {
				for (const question of questions) {
					await connection.query(
						`INSERT INTO question (chapter_id, parent_id, type, stem, options, answer, analysis, difficulty, create_time, update_time)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
						[
							question.chapter_id,
							question.parent_id,
							question.type,
							question.stem,
							question.options,
							question.answer,
							question.analysis,
							question.difficulty,
						]
					);
					questionCount++;
				}
				console.log(`  ✓ 章节 ${chapterId} (${chapterInfo[0]?.name || ''}): 插入 ${questionCountPerChapter} 道题目`);
			} catch (error) {
				console.error(`  ❌ 章节 ${chapterId} 插入题目失败:`, error.message);
				throw error;
			}
		}

		console.log(`\n✓ 共插入 ${questionCount} 道题目\n`);

		// 验证插入的数据
		console.log('\n验证插入的数据...');
		const [courseCount] = await connection.query('SELECT COUNT(*) as count FROM course');
		const [chapterCount] = await connection.query('SELECT COUNT(*) as count FROM chapter');
		const [questionCountVerify] = await connection.query('SELECT COUNT(*) as count FROM question');

		console.log(`  数据库中的课程数: ${courseCount[0].count}`);
		console.log(`  数据库中的章节数: ${chapterCount[0].count}`);
		console.log(`  数据库中的题目数: ${questionCountVerify[0].count}`);

		console.log('\n✅ 测试数据插入完成！');
		console.log(`\n统计信息:`);
		console.log(`  - 本次插入课程数: ${courseIds.length}`);
		console.log(`  - 本次插入章节数: ${chapterIds.length}`);
		console.log(`  - 本次插入题目数: ${questionCount}`);
	} catch (error) {
		console.error('❌ 插入失败:', error.message);
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

insertTestData();
