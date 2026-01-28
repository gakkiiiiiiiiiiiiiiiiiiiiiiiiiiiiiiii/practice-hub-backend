import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import axios from 'axios';

// 加载环境变量
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 动态导入 pdfjs-dist（新版本是 ES Module）
// 在函数中使用动态导入，避免顶层 await
let pdfjsLib: any = null;

async function getPdfjsLib() {
	if (!pdfjsLib) {
		// 新版本 pdfjs-dist 使用 ES Module，必须使用动态导入
		// 使用字符串拼接来避免 TypeScript 编译器识别并转换为 require
		const pdfjsPath1 = 'pdfjs-dist' + '/legacy/build/pdf.mjs';
		const pdfjsPath2 = 'pdfjs-dist' + '/build/pdf.mjs';
		
		// 使用 Function 构造器确保使用真正的动态导入
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const dynamicImport = new Function('specifier', 'return import(specifier)');
		
		try {
			// 优先尝试 legacy 版本
			const pdfjsModule = await dynamicImport(pdfjsPath1);
			pdfjsLib = pdfjsModule.default || pdfjsModule;
			
			// 验证是否有 getDocument 方法
			if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
				throw new Error('pdfjs-dist legacy 版本加载失败');
			}
		} catch (e: any) {
			// 如果 legacy 版本失败，尝试标准版本
			try {
				const pdfjsModule2 = await dynamicImport(pdfjsPath2);
				pdfjsLib = pdfjsModule2.default || pdfjsModule2;
				
				if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
					throw new Error('pdfjs-dist 标准版本加载失败');
				}
			} catch (e2: any) {
				console.error('无法加载 pdfjs-dist:', e2.message);
				throw new Error(`pdfjs-dist 加载失败: ${e2.message}。请确保已正确安装 pdfjs-dist`);
			}
		}
	}
	return pdfjsLib;
}

// 尝试使用pdf2pic（需要系统安装poppler），如果不可用则使用pdfjs-dist文本提取
let pdf2pic: any = null;
try {
	pdf2pic = require('pdf2pic');
} catch (e) {
	// pdf2pic不可用，将使用pdfjs-dist文本提取
}

// 尝试使用canvas作为备用方案
let createCanvas: any = null;
try {
	createCanvas = require('canvas').createCanvas;
} catch (e) {
	// canvas不可用
}

// 硅基流动API配置（从环境变量读取）
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || process.env.SF_API_KEY || '';
const SILICONFLOW_API_BASE = process.env.SILICONFLOW_API_BASE || process.env.SF_API_BASE || 'https://api.siliconflow.cn/v1';
const OCR_MODEL = process.env.OCR_MODEL || process.env.SF_OCR_MODEL || 'PaddlePaddle/PaddleOCR-VL';
const AI_MODEL = process.env.AI_MODEL || process.env.SF_AI_MODEL || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';

// 验证必要的配置（仅在需要调用 API 时检查）
function validateApiConfig() {
	if (!SILICONFLOW_API_KEY) {
		console.error('\n❌ 错误: 未设置 SILICONFLOW_API_KEY 环境变量');
		console.error('\n请在 back-end/.env 文件中添加以下配置:');
		console.error('  SILICONFLOW_API_KEY=your_api_key_here');
		console.error('  SILICONFLOW_API_BASE=https://api.siliconflow.cn/v1  # 可选');
		console.error('  OCR_MODEL=PaddlePaddle/PaddleOCR-VL  # 可选');
		console.error('  AI_MODEL=deepseek-ai/DeepSeek-R1-0528-Qwen3-8B  # 可选');
		console.error('\n或者使用别名:');
		console.error('  SF_API_KEY=your_api_key_here');
		console.error('  SF_API_BASE=https://api.siliconflow.cn/v1');
		console.error('  SF_OCR_MODEL=PaddlePaddle/PaddleOCR-VL');
		console.error('  SF_AI_MODEL=deepseek-ai/DeepSeek-R1-0528-Qwen3-8B');
		console.error('\n详细说明请查看: back-end/scripts/README-PDF-PARSER.md\n');
		process.exit(1);
	}
}

// 题目类型映射
const QUESTION_TYPE_MAP: Record<string, string> = {
	'单选': '单选',
	'单选题': '单选',
	'多选': '多选',
	'多选题': '多选',
	'判断': '判断',
	'判断题': '判断',
	'填空': '填空',
	'填空题': '填空',
	'简答': '简答',
	'简答题': '简答题',
	'阅读理解': '阅读理解',
};

/**
 * 使用pdfjs-dist直接提取PDF页面文本（兼容性最好，无需额外依赖）
 */
async function extractTextFromPage(page: any): Promise<string> {
	try {
		const textContent = await page.getTextContent();
		const textItems = textContent.items.map((item: any) => item.str);
		return textItems.join(' ');
	} catch (error: any) {
		console.warn('文本提取失败，将使用OCR方案:', error.message);
		return '';
	}
}

/**
 * 使用pdf2pic将PDF页面转换为图片（需要系统安装poppler）
 */
async function pdfPageToImageWithPoppler(pdfPath: string, pageNum: number): Promise<Buffer> {
	if (!pdf2pic) {
		throw new Error('pdf2pic不可用，请安装: npm install pdf2pic (需要系统安装poppler)');
	}

	// 确保临时目录存在
	const tempDir = path.join(__dirname, '../temp');
	if (!fs.existsSync(tempDir)) {
		fs.mkdirSync(tempDir, { recursive: true });
	}

	const convert = pdf2pic.fromPath(pdfPath, {
		density: 200, // DPI
		saveFilename: 'temp',
		savePath: tempDir,
		format: 'png',
		width: 2000,
		height: 2000,
	});

	const result = await convert(pageNum, { responseType: 'buffer' });
	return result.buffer;
}

/**
 * 使用canvas将PDF页面转换为图片（备用方案，需要canvas库）
 */
async function pdfPageToImageWithCanvas(page: any): Promise<Buffer> {
	if (!createCanvas) {
		throw new Error('canvas不可用，请安装: npm install canvas');
	}

	const viewport = page.getViewport({ scale: 2.0 });
	const canvas = createCanvas(viewport.width, viewport.height);
	const context = canvas.getContext('2d');

	await page.render({
		canvasContext: context,
		viewport: viewport,
	}).promise;

	return canvas.toBuffer('image/png');
}

/**
 * 调用硅基流动OCR API
 */
async function callOCRAPI(imageBase64: string): Promise<string> {
	// 验证 API 配置
	validateApiConfig();
	
	try {
		const response = await axios.post(
			`${SILICONFLOW_API_BASE}/chat/completions`,
			{
				model: OCR_MODEL,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'text',
								text: '请识别这张图片中的所有文字，包括题目、选项、答案和解析。保持原有的格式和结构。',
							},
							{
								type: 'image_url',
								image_url: {
									url: `data:image/png;base64,${imageBase64}`,
								},
							},
						],
					},
				],
			},
			{
				headers: {
					'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
					'Content-Type': 'application/json',
				},
			}
		);

		return response.data.choices[0].message.content;
	} catch (error: any) {
		console.error('OCR API调用失败:', error.response?.data || error.message);
		throw error;
	}
}

/**
 * 估算文本的 token 数量（保守估算）
 * 使用更保守的估算方式，因为实际 token 数量通常比估算的多
 * 中文字符：约 1 字符 = 1 token（更保守）
 * 英文字符：约 3 字符 = 1 token（更保守）
 */
function estimateTokenCount(text: string): number {
	// 更保守的估算：中文字符数 * 1.0 + 英文字符数 / 3
	const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
	const englishChars = text.length - chineseChars;
	// 使用更保守的估算，并加上 20% 的安全余量
	return Math.ceil((chineseChars * 1.0 + englishChars / 3) * 1.2);
}

/**
 * 将文本分割为多个块，尽量在题目边界处分割
 * @param text 原始文本
 * @param maxTokens 每个块的最大 token 数
 * @returns 文本块数组
 */
function splitTextIntoChunks(text: string, maxTokens: number = 127000): string[] {
	const chunks: string[] = [];
	const lines = text.split('\n');
	
	let currentChunk: string[] = [];
	let currentTokenCount = 0;
	
	// 检测题目开始的模式
	const questionStartPattern = /^[\d一二三四五六七八九十]+[\.、]/;
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineTokenCount = estimateTokenCount(line);
		const isQuestionStart = questionStartPattern.test(line.trim());
		
		// 如果当前块加上这一行会超过限制，且当前块不为空
		if (currentTokenCount + lineTokenCount > maxTokens && currentChunk.length > 0) {
			// 如果这一行是新题目的开始，直接开始新块
			if (isQuestionStart) {
				chunks.push(currentChunk.join('\n'));
				currentChunk = [line];
				currentTokenCount = lineTokenCount;
			} else {
				// 如果不是题目开始，尝试向前查找题目边界
				// 从当前块末尾向前查找，找到最近的题目开始位置
				let splitIndex = currentChunk.length - 1;
				let foundQuestionStart = false;
				
				// 最多向前查找50行
				for (let j = currentChunk.length - 1; j >= Math.max(0, currentChunk.length - 50); j--) {
					if (questionStartPattern.test(currentChunk[j].trim())) {
						splitIndex = j;
						foundQuestionStart = true;
						break;
					}
				}
				
				if (foundQuestionStart && splitIndex > 0) {
					// 在题目边界处分割
					const firstPart = currentChunk.slice(0, splitIndex);
					const secondPart = currentChunk.slice(splitIndex);
					
					chunks.push(firstPart.join('\n'));
					currentChunk = [...secondPart, line];
					currentTokenCount = estimateTokenCount(currentChunk.join('\n'));
				} else {
					// 找不到题目边界，直接分割
					chunks.push(currentChunk.join('\n'));
					currentChunk = [line];
					currentTokenCount = lineTokenCount;
				}
			}
		} else {
			// 添加到当前块
			currentChunk.push(line);
			currentTokenCount += lineTokenCount;
		}
	}
	
	// 添加最后一个块
	if (currentChunk.length > 0) {
		chunks.push(currentChunk.join('\n'));
	}
	
	return chunks;
}

/**
 * 调用 AI API 提取单个文本块的题目
 * 如果块太大，会自动进一步分割
 */
async function extractQuestionsFromChunk(chunkText: string, chunkIndex: number, totalChunks: number): Promise<any[]> {
	// 估算这个块的 token 数量（包括 prompt）
	const promptTemplate = `你是一个专业的题目提取助手。请从以下文本中提取所有题目信息，并按照JSON格式返回。

## 题目类型判断规则：
1. **单选题**：有且仅有一个正确答案，通常有A、B、C、D等选项，答案格式为单个字母（如"A"）
2. **多选题**：有多个正确答案，通常有A、B、C、D等选项，答案格式为多个字母用逗号分隔（如"A,B"）
3. **判断题**：只有两个选项（通常是"正确"/"错误"或"是"/"否"），答案格式为"A"或"B"
4. **填空题**：题干中有空白处（用下划线、括号等标记），需要填写具体内容，答案格式为文本内容
5. **简答题**：**没有提供选项的题目，无论题干如何描述，都归类为简答题**。答案格式为参考答案文本
6. **阅读理解**：包含阅读材料，后面有多个子题，子题可以是选择题或简答题

## 重要规则：
- **如果题目没有提供任何选项（A、B、C、D等），必须归类为"简答题"**
- 即使题干看起来像选择题，如果没有选项，也是简答题
- 简答题的 options 字段应为空对象 {}

## 输出格式：
每个题目包含以下字段：
- type: 题目类型（单选、多选、判断、填空、简答、阅读理解）
- question: 题干内容（完整保留，包括格式标记）
- options: 选项对象（如果是选择题），格式为 {"A": "选项A内容", "B": "选项B内容", ...}。如果没有选项，则为 {}
- answer: 答案
  - 单选题：单个字母，如 "A"
  - 多选题：多个字母用逗号分隔，如 "A,B"
  - 判断题："A" 或 "B"
  - 填空题：答案文本内容
  - 简答题：参考答案文本
- explanation: 解析内容（如果有，如果没有则为空字符串）

## 示例：
[
  {
    "type": "单选",
    "question": "马克思主义的基本原理是什么？",
    "options": {"A": "唯物论", "B": "辩证法", "C": "历史唯物主义", "D": "以上都是"},
    "answer": "D",
    "explanation": "马克思主义包含多个基本原理"
  },
  {
    "type": "简答题",
    "question": "请简述马克思主义的基本原理。",
    "options": {},
    "answer": "马克思主义的基本原理包括：1. 唯物论 2. 辩证法 3. 历史唯物主义",
    "explanation": "这是马克思主义的核心内容"
  }
]

## 文本内容：
`;

	const promptTokens = estimateTokenCount(promptTemplate);
	const chunkTokens = estimateTokenCount(chunkText);
	const totalEstimatedTokens = promptTokens + chunkTokens;
	
	// 如果估算的 token 数量仍然超过限制，进一步分割
	// DeepSeek-R1 支持 128k tokens，但留一些余量，设置为 120000
	if (totalEstimatedTokens > 120000) {
		console.warn(`  第 ${chunkIndex + 1}/${totalChunks} 块仍然太大 (约 ${totalEstimatedTokens} tokens)，进一步分割...`);
		const subChunks = splitTextIntoChunks(chunkText, 100000); // 使用更小的块大小
		console.log(`    分割为 ${subChunks.length} 个子块`);
		
		const subResults: any[] = [];
		for (let i = 0; i < subChunks.length; i++) {
			const subResult = await extractQuestionsFromChunk(subChunks[i], chunkIndex, totalChunks);
			subResults.push(...subResult);
			// 子块之间添加短暂延迟
			if (i < subChunks.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
		}
		return subResults;
	}

	const prompt = promptTemplate + chunkText + '\n\n请只返回JSON数组，不要包含其他文字说明。';

	// 验证 API 配置
	validateApiConfig();

	try {
		const response = await axios.post(
			`${SILICONFLOW_API_BASE}/chat/completions`,
			{
				model: AI_MODEL,
				messages: [
					{
						role: 'user',
						content: prompt,
					},
				],
				temperature: 0.3,
			},
			{
				headers: {
					'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
					'Content-Type': 'application/json',
				},
			}
		);

		const content = response.data.choices[0].message.content.trim();
		
		// 尝试提取JSON部分
		let jsonStr = content;
		const jsonMatch = content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			jsonStr = jsonMatch[0];
		}

		const questions = JSON.parse(jsonStr);
		const result = Array.isArray(questions) ? questions : [questions];
		console.log(`  第 ${chunkIndex + 1}/${totalChunks} 块提取到 ${result.length} 道题目`);
		return result;
	} catch (error: any) {
		const errorMessage = error.response?.data?.message || error.message || '';
		
		// 如果是 token 长度超限错误，自动进一步分割
		if (errorMessage.includes('max_seq_len') || errorMessage.includes('length of prompt_tokens')) {
			console.warn(`  第 ${chunkIndex + 1}/${totalChunks} 块 token 超限，自动进一步分割...`);
			const subChunks = splitTextIntoChunks(chunkText, 100000); // 使用更小的块大小
			console.log(`    分割为 ${subChunks.length} 个子块`);
			
			const subResults: any[] = [];
			for (let i = 0; i < subChunks.length; i++) {
				const subResult = await extractQuestionsFromChunk(subChunks[i], chunkIndex, totalChunks);
				subResults.push(...subResult);
				// 子块之间添加短暂延迟
				if (i < subChunks.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
			return subResults;
		}
		
		// 其他错误，使用备用解析方案
		console.warn(`  第 ${chunkIndex + 1}/${totalChunks} 块提取失败:`, errorMessage);
		return parseQuestionsFromText(chunkText);
	}
}

/**
 * 使用AI提取题目信息（支持分段处理）
 */
async function extractQuestionsWithAI(text: string): Promise<any[]> {
	try {
		// 估算 token 数量
		const estimatedTokens = estimateTokenCount(text);
		// DeepSeek-R1 支持 128k tokens，考虑 prompt 本身也会占用 token（约 1000 tokens），设置为 127000
		const maxTokensPerChunk = 127000; // 128k - 1k 安全余量
		
		// 如果文本较短，直接处理
		if (estimatedTokens <= maxTokensPerChunk) {
			console.log(`文本长度适中 (约 ${estimatedTokens} tokens)，直接处理...`);
			return await extractQuestionsFromChunk(text, 0, 1);
		}
		
		// 需要分段处理
		console.log(`文本较长 (约 ${estimatedTokens} tokens)，将分段处理...`);
		const chunks = splitTextIntoChunks(text, maxTokensPerChunk);
		console.log(`已分割为 ${chunks.length} 个块，开始逐块处理...\n`);
		
		// 并行处理所有块（但限制并发数，避免 API 限制）
		const allQuestions: any[] = [];
		const concurrency = 3; // 最多同时处理3个块
		
		for (let i = 0; i < chunks.length; i += concurrency) {
			const batch = chunks.slice(i, i + concurrency);
			const promises = batch.map((chunk, index) => 
				extractQuestionsFromChunk(chunk, i + index, chunks.length)
			);
			
			const results = await Promise.all(promises);
			allQuestions.push(...results.flat());
			
			// 添加短暂延迟，避免 API 速率限制
			if (i + concurrency < chunks.length) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}
		
		console.log(`\n所有块处理完成，共提取 ${allQuestions.length} 道题目`);
		return allQuestions;
	} catch (error: any) {
		console.warn('AI提取题目失败，使用备用文本解析方案:', error.response?.data || error.message);
		// 如果AI提取失败，尝试简单的文本解析
		const fallbackQuestions = parseQuestionsFromText(text);
		console.log(`备用方案提取到 ${fallbackQuestions.length} 道题目`);
		return fallbackQuestions;
	}
}

/**
 * 简单的文本解析（备用方案）
 */
function parseQuestionsFromText(text: string): any[] {
	const questions: any[] = [];
	const lines = text.split('\n').filter(line => line.trim());

	let currentQuestion: any = null;
	let currentOptions: Record<string, string> = {};
	let inOptions = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// 检测题目开始（通常以数字开头，如"1."、"一、"等）
		if (/^[\d一二三四五六七八九十]+[\.、]/.test(line) || /^[（(]/.test(line)) {
			if (currentQuestion) {
				questions.push(currentQuestion);
			}
			currentQuestion = {
				type: '单选', // 默认类型
				question: line.replace(/^[\d一二三四五六七八九十]+[\.、]/, '').trim(),
				options: {},
				answer: '',
				explanation: '',
			};
			currentOptions = {};
			inOptions = false;
		}
		// 检测选项（A、B、C、D等）
		else if (/^[A-Z][\.、)]/.test(line)) {
			inOptions = true;
			const match = line.match(/^([A-Z])[\.、)](.+)/);
			if (match && currentQuestion) {
				currentOptions[match[1]] = match[2].trim();
				currentQuestion.options = currentOptions;
			}
		}
		// 检测答案（"答案："、"正确答案："等）
		else if (/^答案[：:]/i.test(line) || /^正确[答案][：:]/i.test(line)) {
			if (currentQuestion) {
				currentQuestion.answer = line.replace(/^答案[：:]|^正确[答案][：:]/i, '').trim();
			}
		}
		// 检测解析（"解析："、"说明："等）
		else if (/^解析[：:]|^说明[：:]|^详解[：:]/i.test(line)) {
			if (currentQuestion) {
				currentQuestion.explanation = line.replace(/^解析[：:]|^说明[：:]|^详解[：:]/i, '').trim();
			}
		}
		// 如果不在选项中，可能是题目的延续
		else if (currentQuestion && !inOptions && !currentQuestion.answer) {
			currentQuestion.question += ' ' + line;
		}
		// 如果已有答案，可能是解析的延续
		else if (currentQuestion && currentQuestion.answer && !currentQuestion.explanation) {
			currentQuestion.explanation += ' ' + line;
		}
	}

	// 添加最后一个题目
	if (currentQuestion) {
		questions.push(currentQuestion);
	}

	return questions;
}

/**
 * 保存JSON文件
 */
async function saveJSON(questions: any[], outputPath: string): Promise<void> {
	// 确保输出目录存在
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// 格式化JSON数据
	const jsonData = {
		metadata: {
			total: questions.length,
			generatedAt: new Date().toISOString(),
			version: '1.0',
		},
		questions: questions,
	};

	// 保存文件
	fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), 'utf-8');
	console.log(`✓ JSON文件已生成: ${outputPath}`);
	console.log(`  - 共 ${questions.length} 道题目`);
	console.log(`  - 文件大小: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
}

/**
 * 规范化题型名称
 * 将各种题型名称统一为标准格式
 */
function normalizeQuestionType(type: string): string {
	if (!type) return '单选';
	
	const typeMap: Record<string, string> = {
		// 标准格式
		'单选': '单选',
		'单选题': '单选',
		'多选': '多选',
		'多选题': '多选',
		'判断': '判断',
		'判断题': '判断',
		'填空': '填空',
		'填空题': '填空',
		'简答': '简答',
		'简答题': '简答',
		'阅读理解': '阅读理解',
		'阅读理解题': '阅读理解',
		// 其他可能的格式
		'论述题': '简答',
		'论述': '简答',
		'材料分析题': '简答',
		'材料分析': '简答',
		'分析题': '简答',
	};
	
	return typeMap[type] || '单选';
}

/**
 * 生成Excel文件
 */
async function generateExcel(questions: any[], outputPath: string): Promise<void> {
	const workbook = new ExcelJS.Workbook();
	const worksheet = workbook.addWorksheet('题目导入模板');

	// 设置列宽
	worksheet.columns = [
		{ width: 12 }, // 题型
		{ width: 50 }, // 题干
		{ width: 30 }, // 选项A
		{ width: 30 }, // 选项B
		{ width: 30 }, // 选项C
		{ width: 30 }, // 选项D
		{ width: 20 }, // 答案
		{ width: 50 }, // 解析
	];

	// 设置表头
	const headerRow = worksheet.getRow(1);
	headerRow.values = ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'];
	headerRow.font = { bold: true, size: 12 };
	headerRow.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: 'FFE0E0E0' },
	};
	headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
	headerRow.height = 25;

	// 统计各类型题目数量
	const typeStats: Record<string, number> = {};

	// 添加题目数据
	questions.forEach((q, index) => {
		// 规范化题型
		const normalizedType = normalizeQuestionType(q.type || '单选');
		typeStats[normalizedType] = (typeStats[normalizedType] || 0) + 1;

		// 处理选项
		const options = q.options || {};
		const optionA = options.A || '';
		const optionB = options.B || '';
		const optionC = options.C || '';
		const optionD = options.D || '';

		// 处理答案
		let answer = q.answer || '';
		// 确保答案格式正确（去除空格等）
		if (answer && typeof answer === 'string') {
			answer = answer.trim();
		}

		// 处理解析
		const explanation = q.explanation || '';

		const row = worksheet.addRow([
			normalizedType,
			q.question || '',
			optionA,
			optionB,
			optionC,
			optionD,
			answer,
			explanation,
		]);

		row.height = 20;
		if (index % 2 === 0) {
			row.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFF9F9F9' },
			};
		}
	});

	// 输出统计信息
	if (Object.keys(typeStats).length > 0) {
		console.log('\n题目类型统计:');
		Object.entries(typeStats).forEach(([type, count]) => {
			console.log(`  - ${type}: ${count} 道`);
		});
	}

	// 设置所有单元格的边框
	worksheet.eachRow((row, rowNumber) => {
		row.eachCell((cell) => {
			cell.border = {
				top: { style: 'thin' },
				left: { style: 'thin' },
				bottom: { style: 'thin' },
				right: { style: 'thin' },
			};
			if (rowNumber > 1) {
				cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
			}
		});
	});

	// 确保输出目录存在
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// 保存文件
	await workbook.xlsx.writeFile(outputPath);
	console.log(`✓ Excel文件已生成: ${outputPath}`);
	console.log(`  - 共 ${questions.length} 道题目`);
	console.log(`  - 文件大小: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
}

/**
 * 解析PDF文件
 * 优先使用文本提取，如果失败或质量不好，再使用OCR
 */
async function parsePDF(pdfPath: string, useOCR: boolean = false): Promise<string[]> {
	// 确保 pdfjsLib 已加载
	const pdfLib = await getPdfjsLib();
	
	const data = new Uint8Array(fs.readFileSync(pdfPath));
	const loadingTask = pdfLib.getDocument({ data });
	const pdfDocument = await loadingTask.promise;
	
	const pages: string[] = [];
	const numPages = pdfDocument.numPages;

	console.log(`PDF共有 ${numPages} 页`);
	console.log(`处理模式: ${useOCR ? 'OCR识别' : '文本提取（优先）'}\n`);

	for (let pageNum = 1; pageNum <= numPages; pageNum++) {
		console.log(`正在处理第 ${pageNum}/${numPages} 页...`);
		const page = await pdfDocument.getPage(pageNum);
		
		let pageText = '';

		if (!useOCR) {
			// 优先尝试直接提取文本（兼容性最好，速度最快）
			try {
				pageText = await extractTextFromPage(page);
				if (pageText && pageText.trim().length > 10) {
					// 如果提取到足够的文本，使用文本提取结果
					pages.push(pageText);
					console.log(`✓ 第 ${pageNum} 页文本提取完成 (${pageText.length} 字符)`);
					continue;
				} else {
					console.log(`⚠ 第 ${pageNum} 页文本提取内容较少，切换到OCR模式...`);
					useOCR = true; // 后续页面使用OCR
				}
			} catch (error: any) {
				console.log(`⚠ 第 ${pageNum} 页文本提取失败，切换到OCR模式:`, error.message);
				useOCR = true; // 后续页面使用OCR
			}
		}

		// 使用OCR方案
		if (useOCR) {
			try {
				let imageBuffer: Buffer;
				let imageBase64: string;

				// 优先使用pdf2pic（如果可用）
				if (pdf2pic) {
					try {
						imageBuffer = await pdfPageToImageWithPoppler(pdfPath, pageNum);
						imageBase64 = imageBuffer.toString('base64');
					} catch (error: any) {
						console.warn(`  pdf2pic转换失败，尝试canvas方案:`, error.message);
						// 回退到canvas方案
						if (createCanvas) {
							imageBuffer = await pdfPageToImageWithCanvas(page);
							imageBase64 = imageBuffer.toString('base64');
						} else {
							throw new Error('无法转换PDF页面为图片：pdf2pic和canvas都不可用');
						}
					}
				} else if (createCanvas) {
					// 使用canvas方案
					imageBuffer = await pdfPageToImageWithCanvas(page);
					imageBase64 = imageBuffer.toString('base64');
				} else {
					throw new Error('无法转换PDF页面为图片：请安装 pdf2pic 或 canvas 库');
				}

				// 调用OCR API
				const text = await callOCRAPI(imageBase64);
				if (text && text.trim()) {
					pages.push(text);
					console.log(`✓ 第 ${pageNum} 页OCR完成 (${text.length} 字符)`);
				} else {
					console.warn(`⚠ 第 ${pageNum} 页OCR返回空内容`);
					pages.push('');
				}

				// 添加延迟，避免API调用过快
				await new Promise(resolve => setTimeout(resolve, 1000));
			} catch (error: any) {
				console.error(`✗ 第 ${pageNum} 页OCR失败:`, error.message || error);
				pages.push(''); // 添加空字符串作为占位符
			}
		}
	}

	return pages;
}

/**
 * 从JSON文件生成Excel
 */
async function generateExcelFromJSON(jsonPath: string, excelPath?: string): Promise<void> {
	if (!fs.existsSync(jsonPath)) {
		console.error(`错误: JSON文件不存在: ${jsonPath}`);
		process.exit(1);
	}

	console.log(`读取JSON文件: ${jsonPath}`);
	const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
	const jsonData = JSON.parse(jsonContent);

	// 提取题目数组
	const questions = jsonData.questions || jsonData;
	if (!Array.isArray(questions)) {
		console.error('错误: JSON文件格式不正确，应包含 questions 数组');
		process.exit(1);
	}

	console.log(`从JSON中读取到 ${questions.length} 道题目`);

	// 确定输出路径
	const outputPath = excelPath || jsonPath.replace(/\.json$/i, '.xlsx');
	
	// 生成Excel
	await generateExcel(questions, outputPath);
	console.log('\n✅ 完成！');
	console.log(`📊 Excel文件已保存到: ${outputPath}`);
}

/**
 * 主函数
 */
async function main() {
	const args = process.argv.slice(2);
	
	if (args.length < 1) {
		console.log('使用方法:');
		console.log('  1. 解析PDF: npm run parse:pdf <PDF文件路径> [输出路径] [选项]');
		console.log('  2. 从JSON生成Excel: npm run parse:pdf --json <JSON文件路径> [Excel输出路径]');
		console.log('');
		console.log('选项:');
		console.log('  --ocr, -o       强制使用OCR识别（默认优先使用文本提取）');
		console.log('  --json, -j     从JSON文件生成Excel');
		console.log('');
		console.log('示例:');
		console.log('  npm run parse:pdf /path/to/file.pdf');
		console.log('  npm run parse:pdf /path/to/file.pdf output.xlsx');
		console.log('  npm run parse:pdf /path/to/file.pdf --ocr');
		console.log('  npm run parse:pdf --json /path/to/file.json');
		console.log('  npm run parse:pdf --json /path/to/file.json output.xlsx');
		process.exit(1);
	}

	// 检查是否是从JSON生成Excel
	if (args.includes('--json') || args.includes('-j')) {
		const jsonIndex = args.findIndex(arg => arg === '--json' || arg === '-j');
		const jsonPath = args[jsonIndex + 1];
		const excelPath = args[jsonIndex + 2];
		
		if (!jsonPath) {
			console.error('错误: 请提供JSON文件路径');
			process.exit(1);
		}
		
		await generateExcelFromJSON(jsonPath, excelPath);
		return;
	}

	// 过滤掉选项参数
	const fileArgs = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));
	
	if (fileArgs.length < 1) {
		console.error('错误: 请提供PDF文件路径');
		process.exit(1);
	}

	const pdfPath = path.resolve(fileArgs[0]);
	const baseOutputPath = fileArgs[1] 
		? path.resolve(fileArgs[1])
		: pdfPath.replace(/\.pdf$/i, '_题目导入');
	
	// JSON 文件路径
	const jsonOutputPath = baseOutputPath.endsWith('.json') 
		? baseOutputPath 
		: baseOutputPath + '.json';
	
	// Excel 文件路径
	const excelOutputPath = baseOutputPath.endsWith('.xlsx') 
		? baseOutputPath 
		: baseOutputPath + '.xlsx';

	// 检查文件是否存在
	if (!fs.existsSync(pdfPath)) {
		console.error(`错误: PDF文件不存在: ${pdfPath}`);
		process.exit(1);
	}

	// 检查文件扩展名
	if (!pdfPath.toLowerCase().endsWith('.pdf')) {
		console.error(`错误: 文件不是PDF格式: ${pdfPath}`);
		process.exit(1);
	}

	console.log(`开始解析PDF: ${pdfPath}`);
	console.log(`JSON输出: ${jsonOutputPath}`);
	console.log(`Excel输出: ${excelOutputPath}`);
	
	// 显示可用的转换方案
	console.log('\n可用的转换方案:');
	if (pdf2pic) {
		console.log('  ✓ pdf2pic (poppler) - 可用');
	} else {
		console.log('  ✗ pdf2pic (poppler) - 不可用 (安装: npm install pdf2pic, 需要系统安装poppler)');
	}
	if (createCanvas) {
		console.log('  ✓ canvas - 可用');
	} else {
		console.log('  ✗ canvas - 不可用 (安装: npm install canvas)');
	}
	console.log('  ✓ pdfjs-dist文本提取 - 始终可用（优先使用）');
	console.log('');

	try {
		// 检查是否需要强制使用OCR
		const forceOCR = args.includes('--ocr') || args.includes('-o');
		
		// 1. 解析PDF，获取每页的文本
		const pages = await parsePDF(pdfPath, forceOCR);
		const fullText = pages.filter(p => p.trim()).join('\n\n');

		if (!fullText.trim()) {
			console.error('错误: 未能从PDF中提取任何文本内容');
			process.exit(1);
		}

		console.log(`\nOCR识别完成，共提取 ${fullText.length} 个字符`);
		console.log('正在使用AI提取题目信息...\n');

		// 2. 使用AI提取题目信息
		const questions = await extractQuestionsWithAI(fullText);
		console.log(`提取到 ${questions.length} 道题目\n`);

		if (questions.length === 0) {
			console.warn('警告: 未能提取到任何题目，请检查PDF格式或OCR识别结果');
			console.log('生成空文件...');
		}

		// 3. 先保存JSON文件
		await saveJSON(questions, jsonOutputPath);
		console.log('');

		// 4. 生成Excel文件
		await generateExcel(questions, excelOutputPath);
		console.log('\n✅ 完成！');
		console.log(`📄 JSON文件已保存到: ${jsonOutputPath}`);
		console.log(`📊 Excel文件已保存到: ${excelOutputPath}`);
	} catch (error: any) {
		console.error('\n❌ 处理失败:', error.message);
		if (error.stack) {
			console.error('错误堆栈:', error.stack);
		}
		process.exit(1);
	} finally {
		// 清理临时文件
		const tempDir = path.join(__dirname, '../temp');
		if (fs.existsSync(tempDir)) {
			try {
				const files = fs.readdirSync(tempDir);
				files.forEach(file => {
					if (file.startsWith('temp')) {
						fs.unlinkSync(path.join(tempDir, file));
					}
				});
			} catch (e) {
				// 忽略清理错误
			}
		}
	}
}

// 运行主函数
if (require.main === module) {
	main().catch(console.error);
}
