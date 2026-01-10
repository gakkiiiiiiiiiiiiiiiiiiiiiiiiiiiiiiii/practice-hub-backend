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

// 英语科目真实题目模板
const englishQuestionTemplates = {
	词汇专项: [
		{
			stem: 'The word "ubiquitous" most closely means:',
			options: ['rare', 'everywhere', 'ancient', 'modern'],
			answer: ['B'],
			analysis: '"Ubiquitous" means present, appearing, or found everywhere. It describes something that is very common or widespread. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which of the following words is a synonym for "elaborate"?',
			options: ['simple', 'complex', 'brief', 'quick'],
			answer: ['B'],
			analysis: '"Elaborate" means involving many carefully arranged parts or details; detailed and complicated. Its synonym is "complex". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The prefix "un-" in "unhappy" means:',
			options: ['very', 'not', 'again', 'before'],
			answer: ['B'],
			analysis: 'The prefix "un-" means not or opposite of. "Unhappy" means not happy. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the word that best completes: "She was _____ about her future plans."',
			options: ['ambiguous', 'ambitious', 'ambient', 'ambivalent'],
			answer: ['B'],
			analysis: '"Ambitious" means having or showing a strong desire and determination to succeed. It fits the context of discussing future plans. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The word "ephemeral" means:',
			options: ['permanent', 'temporary', 'eternal', 'lasting'],
			answer: ['B'],
			analysis: '"Ephemeral" means lasting for a very short time; transient. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which word means "to make something better or more acceptable"?',
			options: ['deteriorate', 'ameliorate', 'aggravate', 'exacerbate'],
			answer: ['B'],
			analysis: '"Ameliorate" means to make something bad or unsatisfactory better. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The word "benevolent" is closest in meaning to:',
			options: ['malicious', 'kind', 'indifferent', 'hostile'],
			answer: ['B'],
			analysis: '"Benevolent" means well meaning and kindly. It is the opposite of malicious. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the correct word: "The _____ of the situation was clear to everyone."',
			options: ['gravity', 'levity', 'frivolity', 'triviality'],
			answer: ['A'],
			analysis: '"Gravity" means seriousness or importance, especially in a situation. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Which of the following words means "to praise enthusiastically"?',
			options: ['criticize', 'extol', 'condemn', 'denounce'],
			answer: ['B'],
			analysis: '"Extol" means to praise enthusiastically. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The word "meticulous" means:',
			options: ['careless', 'careful', 'hasty', 'rushed'],
			answer: ['B'],
			analysis: '"Meticulous" means showing great attention to detail; very careful and precise. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which word is the antonym of "profound"?',
			options: ['deep', 'superficial', 'intense', 'serious'],
			answer: ['B'],
			analysis: '"Profound" means having deep insight or understanding. Its antonym is "superficial" which means shallow or lacking depth. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The phrase "to beat around the bush" means:',
			options: ['to be direct', 'to avoid the main topic', 'to be aggressive', 'to be honest'],
			answer: ['B'],
			analysis: '"To beat around the bush" is an idiom meaning to avoid talking about what is important; to avoid the main topic. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which word means "existing in name only"?',
			options: ['nominal', 'actual', 'real', 'genuine'],
			answer: ['A'],
			analysis: '"Nominal" means existing in name only; not real or actual. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'The word "paradox" refers to:',
			options: ['a logical statement', 'a contradictory statement', 'a simple fact', 'an obvious truth'],
			answer: ['B'],
			analysis: '"Paradox" means a statement that contradicts itself but might be true, or a situation that seems impossible but is actually possible. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the word that means "to make less severe":',
			options: ['mitigate', 'aggravate', 'intensify', 'worsen'],
			answer: ['A'],
			analysis: '"Mitigate" means to make less severe, serious, or painful. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Which of the following words means "to express strong disapproval"?',
			options: ['approve', 'endorse', 'condemn', 'support'],
			answer: ['C'],
			analysis: '"Condemn" means to express complete disapproval of, typically in public; censure. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'The word "prudent" is best defined as:',
			options: ['reckless', 'cautious', 'bold', 'rash'],
			answer: ['B'],
			analysis: '"Prudent" means acting with or showing care and thought for the future; wise or judicious. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which word means "to make something worse"?',
			options: ['alleviate', 'ameliorate', 'exacerbate', 'mitigate'],
			answer: ['C'],
			analysis: '"Exacerbate" means to make a problem, bad situation, or negative feeling worse. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'The term "ubiquitous" can be replaced by:',
			options: ['rare', 'omnipresent', 'scarce', 'limited'],
			answer: ['B'],
			analysis: '"Ubiquitous" and "omnipresent" both mean present everywhere or appearing everywhere. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which word means "to reduce in intensity"?',
			options: ['escalate', 'abate', 'increase', 'amplify'],
			answer: ['B'],
			analysis: '"Abate" means to become less intense or widespread; to reduce in intensity. 正确答案是B。',
			type: 1,
		},
	],
	阅读理解: [
		{
			stem: 'According to the passage, what is the main idea?',
			options: ['Technology is harmful', 'Education is important', 'Reading improves vocabulary', 'Exercise is necessary'],
			answer: ['C'],
			analysis: 'The passage emphasizes that reading extensively helps improve vocabulary and language skills. Multiple studies cited in the passage support this claim. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'What can be inferred from the passage about the author\'s attitude?',
			options: ['Negative', 'Positive', 'Neutral', 'Uncertain'],
			answer: ['B'],
			analysis: 'The author uses positive language and examples throughout the passage, indicating a positive attitude toward the subject matter. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The word "it" in paragraph 2 refers to:',
			options: ['the book', 'the concept', 'the method', 'the result'],
			answer: ['A'],
			analysis: 'Based on the context, "it" refers to the book mentioned in the previous sentence. This is a common pronoun reference question. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'What is the author\'s primary purpose in writing this passage?',
			options: ['To entertain', 'To inform', 'To persuade', 'To criticize'],
			answer: ['B'],
			analysis: 'The author presents factual information and research findings, indicating the primary purpose is to inform readers about the topic. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which of the following statements is NOT mentioned in the passage?',
			options: ['Reading enhances comprehension', 'Vocabulary grows with practice', 'Technology affects learning', 'All students improve equally'],
			answer: ['D'],
			analysis: 'The passage discusses various benefits of reading but does not claim that all students improve equally. Individual differences are acknowledged. 正确答案是D。',
			type: 1,
		},
		{
			stem: 'The tone of the passage can best be described as:',
			options: ['sarcastic', 'objective', 'subjective', 'humorous'],
			answer: ['B'],
			analysis: 'The passage presents information in a balanced, factual manner without emotional language, indicating an objective tone. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'According to the passage, which factor is most important?',
			options: ['Time spent reading', 'Type of material', 'Reading speed', 'All are equally important'],
			answer: ['A'],
			analysis: 'The passage emphasizes that consistent time spent reading is the most crucial factor for improvement. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'What does the author suggest about future research?',
			options: ['More studies are needed', 'Research is complete', 'Studies are unreliable', 'No further research needed'],
			answer: ['A'],
			analysis: 'The author mentions that while current research is promising, more longitudinal studies are needed to confirm the findings. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'The passage implies that:',
			options: ['Everyone reads the same way', 'Reading strategies vary', 'Speed is everything', 'Content doesn\'t matter'],
			answer: ['B'],
			analysis: 'The passage discusses different reading strategies and approaches, implying that effective reading strategies can vary among individuals. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which best describes the organization of the passage?',
			options: ['Chronological', 'Cause and effect', 'Problem and solution', 'Compare and contrast'],
			answer: ['C'],
			analysis: 'The passage presents a problem (poor reading skills) and then discusses solutions (various reading strategies). 正确答案是C。',
			type: 1,
		},
		{
			stem: 'The author would most likely agree that:',
			options: ['Reading is unimportant', 'Practice makes perfect', 'Natural talent is everything', 'Books are outdated'],
			answer: ['B'],
			analysis: 'Throughout the passage, the author emphasizes the importance of consistent practice and effort in improving reading skills. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'What is the meaning of "context" as used in the passage?',
			options: ['The surrounding words', 'The main idea', 'The conclusion', 'The introduction'],
			answer: ['A'],
			analysis: 'In reading comprehension, "context" refers to the words, phrases, or sentences that surround a particular word or passage, helping to clarify its meaning. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'The passage suggests that effective reading requires:',
			options: ['Speed only', 'Comprehension only', 'Both speed and comprehension', 'Neither'],
			answer: ['C'],
			analysis: 'The passage discusses both reading speed and comprehension as important components of effective reading. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'Which statement would the author most likely support?',
			options: ['Stop reading difficult texts', 'Challenge yourself with diverse materials', 'Read only easy books', 'Avoid new vocabulary'],
			answer: ['B'],
			analysis: 'The author encourages readers to engage with diverse and challenging materials to improve their skills. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The main argument of the passage is that:',
			options: ['Reading is easy', 'Reading skills can be developed', 'Reading is natural', 'Reading cannot be taught'],
			answer: ['B'],
			analysis: 'The central argument is that reading skills can be developed and improved through practice and proper strategies. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'What does the passage say about vocabulary acquisition?',
			options: ['It happens instantly', 'It requires consistent exposure', 'It is impossible', 'It only happens in school'],
			answer: ['B'],
			analysis: 'The passage emphasizes that vocabulary acquisition is a gradual process that requires consistent exposure to new words in context. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'The author\'s view on technology and reading is:',
			options: ['Completely negative', 'Completely positive', 'Balanced', 'Unclear'],
			answer: ['C'],
			analysis: 'The author presents both benefits and drawbacks of technology in relation to reading, showing a balanced perspective. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'According to the passage, what should readers do when encountering unfamiliar words?',
			options: ['Skip them', 'Look them up immediately', 'Use context clues', 'Ignore the text'],
			answer: ['C'],
			analysis: 'The passage recommends using context clues to understand unfamiliar words before resorting to a dictionary. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'The passage indicates that reading comprehension:',
			options: ['Cannot be improved', 'Is fixed at birth', 'Can be enhanced with practice', 'Depends only on IQ'],
			answer: ['C'],
			analysis: 'The passage clearly states that reading comprehension can be enhanced through practice and proper techniques. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'What is the relationship between reading and writing according to the passage?',
			options: ['Unrelated', 'Closely connected', 'Opposite skills', 'Independent'],
			answer: ['B'],
			analysis: 'The passage discusses how reading extensively improves writing skills, indicating they are closely connected. 正确答案是B。',
			type: 1,
		},
	],
	完形填空: [
		{
			stem: 'Choose the best word: "The students were _____ to learn about the new discovery."',
			options: ['eager', 'reluctant', 'afraid', 'angry'],
			answer: ['A'],
			analysis: '"Eager" means wanting to do or have something very much. The context suggests positive anticipation. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Fill in the blank: "She _____ her homework before dinner."',
			options: ['finished', 'will finish', 'finishes', 'is finishing'],
			answer: ['A'],
			analysis: 'Past tense is needed here as the action happened before dinner (another past event). 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the correct word: "The weather was _____ cold that we stayed indoors."',
			options: ['so', 'such', 'very', 'too'],
			answer: ['A'],
			analysis: 'The structure "so...that" is used to express a result. "So cold that" is the correct grammatical structure. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Select the appropriate word: "He has been working _____ three hours."',
			options: ['for', 'since', 'during', 'while'],
			answer: ['A'],
			analysis: '"For" is used with a period of time (three hours), while "since" is used with a point in time. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the best option: "I haven\'t seen him _____ last week."',
			options: ['for', 'since', 'during', 'from'],
			answer: ['B'],
			analysis: '"Since" is used with a point in time (last week) in present perfect tense. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Fill in the blank: "The book _____ I borrowed from the library is very interesting."',
			options: ['which', 'who', 'where', 'when'],
			answer: ['A'],
			analysis: '"Which" is used as a relative pronoun for things (the book). "Who" is for people, "where" for places, "when" for time. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the correct word: "She is _____ intelligent student in the class."',
			options: ['the most', 'most', 'more', 'the more'],
			answer: ['A'],
			analysis: 'When comparing one person to all others in a group, we use "the most" (superlative form). 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Select the appropriate word: "If I _____ you, I would study harder."',
			options: ['am', 'was', 'were', 'be'],
			answer: ['C'],
			analysis: 'In second conditional (unreal situations), we use "were" for all subjects, not "was". 正确答案是C。',
			type: 1,
		},
		{
			stem: 'Choose the best word: "The meeting has been postponed _____ next Monday."',
			options: ['until', 'by', 'for', 'to'],
			answer: ['A'],
			analysis: '"Until" indicates the time when something will happen. The meeting will happen next Monday. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Fill in the blank: "He apologized _____ being late."',
			options: ['for', 'about', 'to', 'with'],
			answer: ['A'],
			analysis: 'The preposition "for" is used after "apologize" when explaining the reason. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the correct word: "Neither of the students _____ present."',
			options: ['was', 'were', 'are', 'is'],
			answer: ['A'],
			analysis: 'With "neither of", the verb agrees with the singular noun implied. "Was" is correct. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Select the appropriate word: "The company is looking _____ new employees."',
			options: ['for', 'at', 'after', 'into'],
			answer: ['A'],
			analysis: '"Look for" means to search for or try to find. The company is searching for new employees. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the best word: "She insisted _____ going alone."',
			options: ['on', 'in', 'at', 'for'],
			answer: ['A'],
			analysis: 'The preposition "on" is used after "insist" when followed by a gerund (-ing form). 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Fill in the blank: "The report _____ by the committee yesterday."',
			options: ['was discussed', 'discussed', 'is discussed', 'discusses'],
			answer: ['A'],
			analysis: 'Passive voice is needed here. "Was discussed" is the past passive form, matching "yesterday". 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the correct word: "I\'m not used _____ getting up early."',
			options: ['to', 'for', 'with', 'at'],
			answer: ['A'],
			analysis: '"Be used to" means to be accustomed to. It is followed by a noun or gerund. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Select the appropriate word: "The problem requires _____ immediately."',
			options: ['to solve', 'solving', 'solve', 'solved'],
			answer: ['B'],
			analysis: 'After "require", we use a gerund (-ing form) when the subject is the thing being acted upon. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the best word: "He succeeded _____ passing the exam."',
			options: ['in', 'on', 'at', 'for'],
			answer: ['A'],
			analysis: 'The preposition "in" is used after "succeed" when followed by a gerund. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Fill in the blank: "The book is _____ interesting that I couldn\'t put it down."',
			options: ['so', 'such', 'very', 'too'],
			answer: ['A'],
			analysis: 'The structure "so...that" expresses a result. "So interesting that" is grammatically correct. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the correct word: "She is allergic _____ cats."',
			options: ['to', 'with', 'for', 'at'],
			answer: ['A'],
			analysis: 'The preposition "to" is used after "allergic" to indicate what causes the allergy. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Select the appropriate word: "The teacher asked the students _____ quiet."',
			options: ['to be', 'be', 'being', 'been'],
			answer: ['A'],
			analysis: 'After "ask", we use "to + infinitive" form. "To be quiet" is the correct structure. 正确答案是A。',
			type: 1,
		},
	],
	翻译专项: [
		{
			stem: 'Translate: "The early bird catches the worm."',
			options: ['早起的鸟儿有虫吃', '早起的鸟儿没虫吃', '晚起的鸟儿有虫吃', '鸟儿早起抓虫子'],
			answer: ['A'],
			analysis: 'This is a common English proverb meaning that those who act early will succeed. The Chinese equivalent is "早起的鸟儿有虫吃". 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Translate: "Practice makes perfect."',
			options: ['练习使人完美', '完美需要练习', '熟能生巧', '练习很重要'],
			answer: ['C'],
			analysis: 'This proverb means that repeated practice leads to improvement. The idiomatic Chinese translation is "熟能生巧". 正确答案是C。',
			type: 1,
		},
		{
			stem: 'Translate: "Actions speak louder than words."',
			options: ['行动比话语更响亮', '说比做容易', '事实胜于雄辩', '言行一致'],
			answer: ['C'],
			analysis: 'This proverb means that what you do is more important than what you say. The best Chinese equivalent is "事实胜于雄辩". 正确答案是C。',
			type: 1,
		},
		{
			stem: 'Translate: "Where there is a will, there is a way."',
			options: ['有志者事竟成', '有路就有方法', '有意志就有路', '意志决定方法'],
			answer: ['A'],
			analysis: 'This proverb means that if you are determined enough, you can find a way to achieve your goal. The Chinese equivalent is "有志者事竟成". 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Translate: "Time flies."',
			options: ['时间飞了', '时光飞逝', '时间很慢', '时间停止'],
			answer: ['B'],
			analysis: 'This expression means that time passes very quickly. The idiomatic Chinese translation is "时光飞逝". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Better late than never."',
			options: ['迟到总比不到好', '晚做总比不做好', '迟到不好', '永远不晚'],
			answer: ['B'],
			analysis: 'This proverb means it is better to do something late than not to do it at all. The Chinese equivalent is "晚做总比不做好". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Every cloud has a silver lining."',
			options: ['每朵云都有银边', '否极泰来', '乌云密布', '云彩很美'],
			answer: ['B'],
			analysis: 'This proverb means that every difficult situation has a positive aspect. The Chinese equivalent is "否极泰来" or "黑暗中总有一线光明". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Don\'t count your chickens before they hatch."',
			options: ['不要在小鸡孵化前数它们', '不要过早乐观', '数小鸡很重要', '小鸡会孵化'],
			answer: ['B'],
			analysis: 'This proverb means don\'t make plans based on something that hasn\'t happened yet. The Chinese equivalent is "不要过早乐观" or "不要打如意算盘". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "The pen is mightier than the sword."',
			options: ['笔比剑更强大', '文胜于武', '笔很锋利', '剑很危险'],
			answer: ['B'],
			analysis: 'This proverb means that writing and ideas are more powerful than military force. The Chinese equivalent is "文胜于武". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Rome wasn\'t built in a day."',
			options: ['罗马不是一天建成的', '罗马很大', '建设需要时间', '罗马很古老'],
			answer: ['A'],
			analysis: 'This proverb means that important things take time to achieve. The direct translation "罗马不是一天建成的" is commonly used in Chinese. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Translate: "A picture is worth a thousand words."',
			options: ['一张图片值一千个字', '一图胜千言', '图片很重要', '文字很多'],
			answer: ['B'],
			analysis: 'This expression means that visual communication can be more effective than words. The Chinese equivalent is "一图胜千言". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "When in Rome, do as the Romans do."',
			options: ['在罗马时，像罗马人一样做', '入乡随俗', '罗马人很特别', '要适应环境'],
			answer: ['B'],
			analysis: 'This proverb means to adapt to the customs of the place you are visiting. The Chinese equivalent is "入乡随俗". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "The ball is in your court."',
			options: ['球在你的场地', '决定权在你', '球很重要', '场地很大'],
			answer: ['B'],
			analysis: 'This idiom means it is your turn to make a decision or take action. The Chinese equivalent is "决定权在你" or "该你行动了". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Break the ice."',
			options: ['打破冰块', '打破僵局', '冰很冷', '需要破冰'],
			answer: ['B'],
			analysis: 'This idiom means to initiate conversation in a social setting. The Chinese equivalent is "打破僵局" or "活跃气氛". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Hit the nail on the head."',
			options: ['敲钉子', '一针见血', '很准确', '打中头部'],
			answer: ['B'],
			analysis: 'This idiom means to be exactly right about something. The Chinese equivalent is "一针见血" or "说到点子上". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Bite the bullet."',
			options: ['咬子弹', '硬着头皮做', '很勇敢', '承受痛苦'],
			answer: ['B'],
			analysis: 'This idiom means to endure a painful or difficult situation. The Chinese equivalent is "硬着头皮做" or "咬紧牙关". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "The elephant in the room."',
			options: ['房间里的象', '显而易见的问题', '大象很大', '房间很小'],
			answer: ['B'],
			analysis: 'This idiom refers to an obvious problem that everyone is aware of but no one wants to discuss. The Chinese equivalent is "显而易见的问题" or "房间里的大象". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Once in a blue moon."',
			options: ['蓝月亮时', '千载难逢', '月亮很蓝', '很少见'],
			answer: ['B'],
			analysis: 'This idiom means very rarely. The Chinese equivalent is "千载难逢" or "极其罕见". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "Under the weather."',
			options: ['在天气下', '身体不适', '天气不好', '在户外'],
			answer: ['B'],
			analysis: 'This idiom means to feel unwell or sick. The Chinese equivalent is "身体不适" or "不舒服". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Translate: "A blessing in disguise."',
			options: ['伪装的祝福', '因祸得福', '隐藏的祝福', '好运'],
			answer: ['B'],
			analysis: 'This idiom means something that seems bad but actually has a good result. The Chinese equivalent is "因祸得福". 正确答案是B。',
			type: 1,
		},
	],
	写作训练: [
		{
			stem: 'Which sentence is grammatically correct?',
			options: ['He don\'t like it', 'He doesn\'t like it', 'He not like it', 'He no like it'],
			answer: ['B'],
			analysis: 'Third person singular requires "doesn\'t" not "don\'t". The correct form is "He doesn\'t like it". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the best topic sentence for a paragraph about environmental protection:',
			options: ['Many people like nature', 'Environmental protection is crucial for our future', 'Some animals are cute', 'Weather changes often'],
			answer: ['B'],
			analysis: 'A topic sentence should introduce the main idea of the paragraph. "Environmental protection is crucial for our future" clearly states the main theme. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence uses the correct verb tense?',
			options: ['I am going to the store yesterday', 'I went to the store yesterday', 'I go to the store yesterday', 'I will go to the store yesterday'],
			answer: ['B'],
			analysis: 'Past tense "went" is required for an action completed in the past (yesterday). 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the sentence with correct subject-verb agreement:',
			options: ['The students is studying', 'The students are studying', 'The students am studying', 'The students be studying'],
			answer: ['B'],
			analysis: 'Plural subject "students" requires plural verb "are". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence is correctly punctuated?',
			options: ['She said "Hello"', 'She said, "Hello."', 'She said "Hello".', 'She said, "Hello"'],
			answer: ['B'],
			analysis: 'In dialogue, a comma is needed before the quotation, and the period goes inside the quotation marks. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the best transition word: "The weather was bad. _____, we decided to stay home."',
			options: ['However', 'Therefore', 'Moreover', 'Furthermore'],
			answer: ['B'],
			analysis: '"Therefore" indicates a logical result. The bad weather led to the decision to stay home. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence uses the passive voice correctly?',
			options: ['The book was written by him', 'Him wrote the book', 'The book wrote by him', 'The book is wrote by him'],
			answer: ['A'],
			analysis: 'Passive voice structure: subject + was/were + past participle + by + agent. "The book was written by him" is correct. 正确答案是A。',
			type: 1,
		},
		{
			stem: 'Choose the sentence with correct word order:',
			options: ['I yesterday went to the store', 'I went yesterday to the store', 'I went to the store yesterday', 'Yesterday I went to store the'],
			answer: ['C'],
			analysis: 'Time expressions typically come at the end of the sentence in English. "I went to the store yesterday" follows correct word order. 正确答案是C。',
			type: 1,
		},
		{
			stem: 'Which sentence uses the correct conditional form?',
			options: ['If I will see him, I will tell him', 'If I see him, I will tell him', 'If I see him, I tell him', 'If I saw him, I will tell him'],
			answer: ['B'],
			analysis: 'First conditional uses present simple in the if-clause and future simple in the main clause. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the best concluding sentence:',
			options: ['In conclusion, the topic is interesting', 'In conclusion, education plays a vital role in personal development', 'The topic is discussed', 'Many things were mentioned'],
			answer: ['B'],
			analysis: 'A good conclusion should summarize the main point. "Education plays a vital role in personal development" effectively concludes a paragraph about education. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence uses articles correctly?',
			options: ['I need an advice', 'I need advice', 'I need a advice', 'I need the advice'],
			answer: ['B'],
			analysis: '"Advice" is an uncountable noun and does not take an article. "I need advice" is correct. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the sentence with correct parallel structure:',
			options: ['She likes reading, writing, and to dance', 'She likes reading, writing, and dancing', 'She likes to read, writing, and dancing', 'She likes reading, to write, and dancing'],
			answer: ['B'],
			analysis: 'Parallel structure requires consistent verb forms. All items should be gerunds: "reading, writing, and dancing". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence correctly uses a relative clause?',
			options: ['The man which I met was friendly', 'The man who I met was friendly', 'The man what I met was friendly', 'The man where I met was friendly'],
			answer: ['B'],
			analysis: '"Who" is used for people in relative clauses. "Which" is for things, "what" and "where" don\'t work here. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the best sentence for formal writing:',
			options: ['I think it\'s really cool', 'I believe it is quite impressive', 'It\'s awesome', 'It\'s totally great'],
			answer: ['B'],
			analysis: 'Formal writing requires formal language. "I believe it is quite impressive" is more appropriate than colloquial expressions. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence uses the subjunctive mood correctly?',
			options: ['I suggest that he goes', 'I suggest that he go', 'I suggest that he went', 'I suggest that he going'],
			answer: ['B'],
			analysis: 'After "suggest", the subjunctive mood uses the base form of the verb. "I suggest that he go" is correct. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the sentence with correct capitalization:',
			options: ['i went to paris last summer', 'I went to Paris last summer', 'I Went To Paris Last Summer', 'I went to paris Last Summer'],
			answer: ['B'],
			analysis: 'Proper nouns (Paris) should be capitalized, but not every word. "I went to Paris last summer" follows correct capitalization rules. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Which sentence uses the correct form of "there"?',
			options: ['Their is a problem', 'There is a problem', 'They\'re is a problem', 'There are a problem'],
			answer: ['B'],
			analysis: '"There" is used to indicate existence. "There is" is correct for singular subjects. 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the best sentence structure:',
			options: ['Because it was raining, so we stayed home', 'Because it was raining, we stayed home', 'It was raining, so we stayed home', 'Both B and C'],
			answer: ['D'],
			analysis: 'Both "Because...we stayed" and "It was raining, so we stayed" are correct. You cannot use "because" and "so" together. 正确答案是D。',
			type: 1,
		},
		{
			stem: 'Which sentence uses the correct comparative form?',
			options: ['She is more taller than him', 'She is taller than him', 'She is more tall than him', 'She is tallest than him'],
			answer: ['B'],
			analysis: 'One-syllable adjectives use "-er" for comparatives. "Taller" is correct, not "more taller". 正确答案是B。',
			type: 1,
		},
		{
			stem: 'Choose the sentence with correct use of "few" and "little":',
			options: ['I have few money', 'I have little money', 'I have a few money', 'I have a little money'],
			answer: ['B'],
			analysis: '"Little" is used with uncountable nouns (money). "Few" is for countable nouns. "I have little money" is correct. 正确答案是B。',
			type: 1,
		},
	],
};

// 生成题目
function generateEnglishQuestions(chapterId, chapterName, count = 20) {
	const questions = [];
	
	// 获取该章节的题目模板
	let templates = englishQuestionTemplates[chapterName] || [];
	
	// 如果模板不足，生成通用题目
	for (let i = 1; i <= count; i++) {
		let stem, options, answer, analysis, type;
		
		// 如果有模板且未用完，使用模板
		if (templates.length > 0 && i <= templates.length) {
			const template = templates[i - 1];
			stem = template.stem;
			options = template.options.map((opt, idx) => ({ label: String.fromCharCode(65 + idx), text: opt }));
			answer = template.answer;
			analysis = template.analysis;
			type = template.type || 1;
		} else {
			// 生成通用题目
			type = [1, 2, 3][Math.floor(Math.random() * 3)];
			stem = `关于${chapterName}的相关知识，请选择正确答案。`;
			options = generateOptions(type);
			answer = generateAnswer(type);
			analysis = `本题考查${chapterName}的相关知识点。正确答案是${answer.join('、')}。`;
		}
		
		const difficulty = Math.floor(Math.random() * 3) + 1; // 1-3
		
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

// 生成题目选项
function generateOptions(type) {
	if (type === 1) {
		return [
			{ label: 'A', text: '选项A' },
			{ label: 'B', text: '选项B' },
			{ label: 'C', text: '选项C' },
			{ label: 'D', text: '选项D' },
		];
	} else if (type === 2) {
		return [
			{ label: 'A', text: '选项A' },
			{ label: 'B', text: '选项B' },
			{ label: 'C', text: '选项C' },
			{ label: 'D', text: '选项D' },
			{ label: 'E', text: '选项E' },
		];
	} else if (type === 3) {
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
		const answers = ['A', 'B', 'C', 'D'];
		return [answers[Math.floor(Math.random() * answers.length)]];
	} else if (type === 2) {
		const answers = ['A', 'B', 'C', 'D', 'E'];
		const count = Math.floor(Math.random() * 2) + 2;
		const selected = answers.sort(() => Math.random() - 0.5).slice(0, count);
		return selected.sort();
	} else if (type === 3) {
		return Math.random() > 0.5 ? ['A'] : ['B'];
	}
	return [];
}

async function insertEnglishQuestions() {
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

		// 查找英语科目的所有章节
		console.log('查找英语科目的章节...');
		const [chapters] = await connection.query(
			`SELECT c.id, c.name, c.type, co.subject 
			FROM chapter c 
			JOIN course co ON c.course_id = co.id 
			WHERE co.subject = '英语'
			ORDER BY c.id`
		);

		if (chapters.length === 0) {
			console.log('⚠️  未找到英语科目的章节，请先创建英语课程和章节');
			await connection.end();
			return;
		}

		console.log(`找到 ${chapters.length} 个英语章节\n`);

		// 插入题目
		console.log('开始插入英语题目数据...');
		let questionCount = 0;

		for (const chapter of chapters) {
			let questionCountPerChapter = 20;
			if (chapter.type === 'year') {
				questionCountPerChapter = 30;
			}

			const questions = generateEnglishQuestions(chapter.id, chapter.name, questionCountPerChapter);

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
				console.log(`  ✓ 章节 ${chapter.id} (${chapter.name}): 插入 ${questionCountPerChapter} 道题目`);
			} catch (error) {
				console.error(`  ❌ 章节 ${chapter.id} 插入题目失败:`, error.message);
				throw error;
			}
		}

		console.log(`\n✓ 共插入 ${questionCount} 道英语题目\n`);

		// 验证插入的数据
		console.log('验证插入的数据...');
		const [questionCountVerify] = await connection.query(
			`SELECT COUNT(*) as count 
			FROM question q
			JOIN chapter c ON q.chapter_id = c.id
			JOIN course co ON c.course_id = co.id
			WHERE co.subject = '英语'`
		);

		console.log(`  数据库中的英语题目数: ${questionCountVerify[0].count}`);

		console.log('\n✅ 英语题目数据插入完成！');
		console.log(`\n统计信息:`);
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

insertEnglishQuestions();
