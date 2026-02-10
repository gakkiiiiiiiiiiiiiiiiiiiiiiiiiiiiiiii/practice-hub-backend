/**
 * PDF 题目提取脚本（火山引擎方舟 API）
 * 按页分段拆分 PDF，分批上传并请求，最后合并结果，避免单次 token 超限。
 *
 * 使用：npm run parse:pdf <PDF路径> [输出路径]
 * 从 JSON 生成 Excel：npm run parse:pdf -- --json <JSON路径> [Excel路径]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ExcelJS from 'exceljs';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 火山引擎（方舟）配置
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_API_BASE = (process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3/responses').replace(
	/\/+$/,
	'',
);
const ARK_MODEL = process.env.ARK_MODEL || '';

function getArkApiRoot(): string {
	const base = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3/responses';
	return base.replace(/\/responses\/?$/, '');
}

function validateArkConfig(): void {
	if (!ARK_API_KEY) {
		console.error('\n❌ 未设置 ARK_API_KEY，请在 back-end/.env 中配置火山引擎方舟 API Key');
		process.exit(1);
	}
	if (!ARK_MODEL) {
		console.error('\n❌ 未设置 ARK_MODEL（推理接入点 ID），请在 back-end/.env 中配置');
		process.exit(1);
	}
}

const QUESTION_TYPE_MAP: Record<string, string> = {
	单选: '单选',
	单选题: '单选',
	多选: '多选',
	多选题: '多选',
	判断: '判断',
	判断题: '判断',
	填空: '填空',
	填空题: '填空',
	简答: '简答',
	简答题: '简答',
	阅读理解: '阅读理解',
};

function normalizeQuestionType(type: string): string {
	const t = String(type || '').trim();
	return QUESTION_TYPE_MAP[t] || t || '单选';
}

// 提示尽量简短以节省 token，配合按段分批避免超限
const ARK_EXTRACT_PROMPT = `你是一个专业的题目提取助手。请从pdf文件中提取所有题目信息，并按照JSON格式返回。

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
]`;

/** 每批最多页数（仅在不做语义切分时用作是否分批的阈值） */
const PAGES_PER_BATCH = 4;

/** 语义分段时每批大致字符上限，用于控制 token，避免超限 */
const MAX_CHARS_PER_BATCH = 6500;

/**
 * 获取 PDF 总页数
 */
async function getPdfPageCount(pdfPath: string): Promise<number> {
	const bytes = fs.readFileSync(pdfPath);
	const doc = await PDFDocument.load(bytes);
	return doc.getPageCount();
}

/** 初始化 pdfjs worker（Node 下必须） */
function initPdfJsWorker(): void {
	try {
		const pdfjs = require('pdfjs-dist');
		if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
			const workerPath = path.join(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
			if (fs.existsSync(workerPath)) {
				pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
			}
		}
	} catch (_) {}
}

/**
 * 用 pdfjs-dist 按页提取文本
 */
async function extractTextByPage(pdfPath: string): Promise<{ pageIndex: number; text: string }[]> {
	initPdfJsWorker();
	const { getDocument } = require('pdfjs-dist');
	const buffer = fs.readFileSync(pdfPath);
	const data = new Uint8Array(buffer);
	const doc = await getDocument({ data }).promise;
	const numPages = doc.numPages;
	const pages: { pageIndex: number; text: string }[] = [];
	for (let i = 1; i <= numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const text = (content.items as { str?: string }[])
			.map((item) => item.str || '')
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		pages.push({ pageIndex: i - 1, text });
	}
	return pages;
}

/**
 * 按段落/题目语义切分：双换行视为段落边界，题号（1. 一、（1）第1题 等）也视为切分点
 */
function splitIntoSemanticBlocks(pages: { pageIndex: number; text: string }[]): { pageIndex: number; text: string }[] {
	const blocks: { pageIndex: number; text: string }[] = [];
	// 题号或段落起始（用于在长页内再切分）
	const questionBoundary =
		/(?=\n\s*(\d+[\.．]、|\d+\.\s|[一二三四五六七八九十]+[、．.]\s|[（(]\d+[)）]\s|第\s*\d+\s*题\s*[:：]?))/;
	for (const { pageIndex, text } of pages) {
		if (!text.trim()) continue;
		// 先按双换行拆成段落
		const paras = text.split(/\n\s*\n+/).filter((s) => s.trim());
		for (const para of paras) {
			const sub = para.split(questionBoundary).filter((s) => s.trim());
			sub.forEach((s) => blocks.push({ pageIndex, text: s.trim() }));
		}
	}
	// 若整份都没有双换行/题号，则按页为一块
	if (blocks.length === 0) {
		pages.forEach((p) => {
			if (p.text.trim()) blocks.push({ pageIndex: p.pageIndex, text: p.text.trim() });
		});
	}
	return blocks;
}

/**
 * 将语义块按字符数合并为批次，每批不超过 maxChars，且不跨断点拆开同一批的页码连续区间
 * 返回每批对应的页范围 [startPage, endPage]（0-based），用于生成 PDF 片段
 */
function groupBlocksIntoPageRanges(
	blocks: { pageIndex: number; text: string }[],
	maxChars: number,
): [number, number][] {
	if (blocks.length === 0) return [];
	const ranges: [number, number][] = [];
	let acc = 0;
	let rangeStart = blocks[0].pageIndex;
	let rangeEnd = blocks[0].pageIndex;

	for (let i = 0; i < blocks.length; i++) {
		const { pageIndex, text } = blocks[i];
		const len = text.length;
		const wouldExceed = acc + len > maxChars && acc > 0;
		if (wouldExceed) {
			ranges.push([rangeStart, rangeEnd]);
			acc = 0;
			rangeStart = pageIndex;
			rangeEnd = pageIndex;
		}
		acc += len;
		rangeEnd = Math.max(rangeEnd, pageIndex);
	}
	ranges.push([rangeStart, rangeEnd]);
	return ranges;
}

/**
 * 按给定页范围（0-based [start,end]）拆成多个临时 PDF
 */
async function splitPdfIntoChunkFilesByPageRanges(pdfPath: string, pageRanges: [number, number][]): Promise<string[]> {
	const bytes = fs.readFileSync(pdfPath);
	const src = await PDFDocument.load(bytes);
	const outPaths: string[] = [];
	const tmpDir = path.join(os.tmpdir(), 'parse-pdf-ark-' + Date.now());
	fs.mkdirSync(tmpDir, { recursive: true });

	for (let i = 0; i < pageRanges.length; i++) {
		const [start, end] = pageRanges[i];
		const indices = Array.from({ length: end - start + 1 }, (_, j) => start + j);
		const doc = await PDFDocument.create();
		const copied = await doc.copyPages(src, indices);
		copied.forEach((p) => doc.addPage(p));
		const buf = await doc.save();
		const chunkPath = path.join(tmpDir, `chunk_${i + 1}_p${start + 1}-${end + 1}.pdf`);
		fs.writeFileSync(chunkPath, buf);
		outPaths.push(chunkPath);
	}
	return outPaths;
}

/**
 * 按页数拆分成多个临时 PDF 文件（固定每段页数，兜底用）
 */
async function splitPdfIntoChunkFiles(pdfPath: string, pagesPerChunk: number): Promise<string[]> {
	const pageCount = await getPdfPageCount(pdfPath);
	const ranges: [number, number][] = [];
	for (let start = 0; start < pageCount; start += pagesPerChunk) {
		const end = Math.min(start + pagesPerChunk, pageCount) - 1;
		ranges.push([start, end]);
	}
	return splitPdfIntoChunkFilesByPageRanges(pdfPath, ranges);
}

/**
 * 上传 PDF 到方舟 Files API
 */
async function uploadPdfToArk(pdfPath: string): Promise<string> {
	validateArkConfig();
	const apiRoot = getArkApiRoot();
	const uploadUrl = `${apiRoot}/files`;
	const fileBuffer = fs.readFileSync(pdfPath);
	const fileName = path.basename(pdfPath);

	let FormData: any;
	try {
		FormData = require('form-data');
	} catch {
		throw new Error('请安装 form-data: npm install form-data');
	}
	const form = new FormData();
	form.append('purpose', 'user_data');
	form.append('file', fileBuffer, { filename: fileName, contentType: 'application/pdf' });

	const res = await axios.post(uploadUrl, form, {
		headers: { Authorization: `Bearer ${ARK_API_KEY}`, ...form.getHeaders() },
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
		validateStatus: () => true,
	});

	if (res.status !== 200 && res.status !== 201) {
		console.error('方舟上传响应:', res.status, res.data);
		throw new Error(`方舟上传失败 (${res.status})，请检查接入点与 Files API 配置`);
	}
	const fileId = res.data?.id ?? res.data?.file_id ?? res.data?.data?.id;
	if (!fileId) throw new Error('方舟返回中无 file_id: ' + JSON.stringify(res.data));
	return String(fileId);
}

const FILE_POLL_INTERVAL_MS = 2500;
const FILE_POLL_TIMEOUT_MS = 120000;

/**
 * 轮询文件状态，直到方舟处理完成（非 processing）后再继续
 */
async function waitForFileReady(fileId: string): Promise<void> {
	const apiRoot = getArkApiRoot();
	const url = `${apiRoot}/files/${fileId}`;
	const start = Date.now();
	while (Date.now() - start < FILE_POLL_TIMEOUT_MS) {
		const res = await axios.get(url, {
			headers: { Authorization: `Bearer ${ARK_API_KEY}` },
			validateStatus: () => true,
		});
		if (res.status !== 200) {
			throw new Error(`查询文件状态失败 (${res.status}): ${JSON.stringify(res.data)}`);
		}
		const status = (res.data?.status ?? res.data?.state ?? '').toLowerCase();
		if (status === 'processing') {
			process.stdout.write('.');
			await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
			continue;
		}
		if (status === 'failed' || status === 'error') {
			throw new Error('文件处理失败: ' + (res.data?.message ?? res.data?.error ?? status));
		}
		return;
	}
	throw new Error('等待文件就绪超时，请稍后重试');
}

/**
 * 调用方舟 Responses API，根据 file_id 提取题目
 */
async function extractQuestionsFromPdfWithArk(fileId: string): Promise<any[]> {
	validateArkConfig();
	const body = {
		model: ARK_MODEL,
		input: [
			{
				role: 'user',
				content: [
					{
						type: 'input_file',
						file_id: fileId,
					},
					{
						type: 'input_text',
						text: ARK_EXTRACT_PROMPT,
					},
				],
			},
		],
	};

	const res = await axios
		.post(ARK_API_BASE, body, {
			headers: { Authorization: `Bearer ${ARK_API_KEY}`, 'Content-Type': 'application/json' },
			timeout: 300000,
		})
		.catch((err: any) => {
			const msg = err.response?.data?.message ?? err.response?.data?.error ?? err.message;
			throw new Error('方舟 Responses 调用失败: ' + JSON.stringify(msg));
		});

	const data = res.data;
	if (data?.status === 'in_progress' || (data?.id && !data?.output)) {
		throw new Error('当前返回为异步任务，脚本暂不支持轮询，请使用同步响应的接入点');
	}

	const output = data?.output ?? data;
	let text = output?.choices?.[0]?.message?.content ?? output?.message?.content ?? output?.text ?? output?.content;
	if (typeof text !== 'string')
		text = Array.isArray(text) ? (text[0]?.text ?? JSON.stringify(text)) : JSON.stringify(output);
	text = String(text).trim();

	const jsonMatch = text.match(/\[[\s\S]*\]/);
	const jsonStr = jsonMatch ? jsonMatch[0] : text;
	const questions = JSON.parse(jsonStr);
	return Array.isArray(questions) ? questions : [questions];
}

function saveJSON(questions: any[], filePath: string): void {
	fs.writeFileSync(filePath, JSON.stringify({ questions }, null, 2), 'utf-8');
	console.log('✓ JSON 已保存:', filePath);
}

async function generateExcel(questions: any[], outputPath: string): Promise<void> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('题目', { views: [{ state: 'frozen', ySplit: 1 }] });
	sheet.columns = [
		{ header: '题型', key: 'type', width: 12 },
		{ header: '题干', key: 'question', width: 50 },
		{ header: '选项A', key: 'optionA', width: 30 },
		{ header: '选项B', key: 'optionB', width: 30 },
		{ header: '选项C', key: 'optionC', width: 30 },
		{ header: '选项D', key: 'optionD', width: 30 },
		{ header: '答案', key: 'answer', width: 20 },
		{ header: '解析', key: 'explanation', width: 50 },
	];
	sheet.getRow(1).font = { bold: true };
	sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

	questions.forEach((q) => {
		const options = q.options || {};
		sheet.addRow({
			type: normalizeQuestionType(q.type),
			question: q.question || '',
			optionA: options.A || '',
			optionB: options.B || '',
			optionC: options.C || '',
			optionD: options.D || '',
			answer: (q.answer || '').trim(),
			explanation: q.explanation || '',
		});
	});

	const dir = path.dirname(outputPath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	await workbook.xlsx.writeFile(outputPath);
	console.log('✓ Excel 已生成:', outputPath, `(${questions.length} 道题)`);
}

async function generateExcelFromJSON(jsonPath: string, excelPath?: string): Promise<void> {
	if (!fs.existsSync(jsonPath)) {
		console.error('JSON 文件不存在:', jsonPath);
		process.exit(1);
	}
	const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
	const questions = raw.questions || raw;
	if (!Array.isArray(questions)) {
		console.error('JSON 中需包含 questions 数组');
		process.exit(1);
	}
	const out = excelPath || jsonPath.replace(/\.json$/i, '.xlsx');
	await generateExcel(questions, out);
	console.log('\n✅ 完成:', out);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes('--json') || args.includes('-j')) {
		const i = args.findIndex((a) => a === '--json' || a === '-j');
		const jsonPath = args[i + 1];
		const excelPath = args[i + 2];
		if (!jsonPath) {
			console.error('请提供 JSON 路径: npm run parse:pdf -- --json <JSON路径> [Excel路径]');
			process.exit(1);
		}
		await generateExcelFromJSON(jsonPath, excelPath);
		return;
	}

	const fileArgs = args.filter((a) => !a.startsWith('--') && !a.startsWith('-'));
	if (fileArgs.length < 1) {
		console.log('用法:');
		console.log('  解析 PDF: npm run parse:pdf <PDF路径> [输出路径]');
		console.log('  从 JSON 生成 Excel: npm run parse:pdf -- --json <JSON路径> [Excel路径]');
		process.exit(1);
	}

	const pdfPath = path.resolve(fileArgs[0]);
	const baseOut = fileArgs[1] ? path.resolve(fileArgs[1]) : pdfPath.replace(/\.pdf$/i, '_题目导入');
	const jsonPath = baseOut.endsWith('.json') ? baseOut : baseOut + '.json';
	const excelPath = baseOut.endsWith('.xlsx') ? baseOut : baseOut + '.xlsx';

	if (!fs.existsSync(pdfPath)) {
		console.error('PDF 不存在:', pdfPath);
		process.exit(1);
	}
	if (!pdfPath.toLowerCase().endsWith('.pdf')) {
		console.error('请指定 .pdf 文件');
		process.exit(1);
	}

	console.log('PDF:', pdfPath);
	console.log('使用火山引擎（方舟）按段拆分、分批请求并合并结果...\n');

	try {
		const pageCount = await getPdfPageCount(pdfPath);
		console.log('总页数:', pageCount);

		let chunkPaths: string[] = [];
		const useBatch = pageCount > PAGES_PER_BATCH;
		if (useBatch) {
			try {
				console.log('按段落/语义切分中（提取文本 → 分段 → 按批生成 PDF）...');
				const pages = await extractTextByPage(pdfPath);
				const blocks = splitIntoSemanticBlocks(pages);
				const pageRanges = groupBlocksIntoPageRanges(blocks, MAX_CHARS_PER_BATCH);
				console.log(`共 ${blocks.length} 个语义块，分为 ${pageRanges.length} 批`);
				chunkPaths = await splitPdfIntoChunkFilesByPageRanges(pdfPath, pageRanges);
			} catch (e: any) {
				console.warn('语义切分失败，改用按页数分段:', e?.message || e);
				chunkPaths = await splitPdfIntoChunkFiles(pdfPath, PAGES_PER_BATCH);
			}
		} else {
			chunkPaths = [pdfPath];
		}

		const allQuestions: any[] = [];
		for (let i = 0; i < chunkPaths.length; i++) {
			const chunkPath = chunkPaths[i];
			const label = useBatch ? `[${i + 1}/${chunkPaths.length}]` : '';
			console.log(`\n${label} 正在上传...`);
			const fileId = await uploadPdfToArk(chunkPath);
			console.log(`${label} 等待文件处理完成`);
			await waitForFileReady(fileId);
			console.log(`\n${label} 正在调用模型提取题目...`);
			const questions = await extractQuestionsFromPdfWithArk(fileId);
			allQuestions.push(...questions);
			console.log(`${label} 本批提取 ${questions.length} 道题`);
		}

		// 仅删除本次创建的临时拆分文件（在 os.tmpdir 下的目录）
		if (useBatch && chunkPaths.length > 0) {
			const tmpDir = path.dirname(chunkPaths[0]);
			if (tmpDir.includes('parse-pdf-ark-')) {
				chunkPaths.forEach((p) => {
					try {
						fs.unlinkSync(p);
					} catch (_) {}
				});
				try {
					fs.rmdirSync(tmpDir);
				} catch (_) {}
			}
		}

		console.log('\n合计提取', allQuestions.length, '道题目');
		saveJSON(allQuestions, jsonPath);
		await generateExcel(allQuestions, excelPath);
		console.log('\n✅ 完成');
		console.log('  JSON:', jsonPath);
		console.log('  Excel:', excelPath);
	} catch (e: any) {
		console.error('\n❌ 失败:', e.message);
		if (e.response?.data) console.error(e.response.data);
		process.exit(1);
	}
}

if (require.main === module) {
	main().catch(console.error);
}
