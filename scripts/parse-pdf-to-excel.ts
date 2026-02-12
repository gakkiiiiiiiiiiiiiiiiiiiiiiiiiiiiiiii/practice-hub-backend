/**
 * PDF 题目提取脚本（委托 src/modules/process-pdf 核心，pdf-parse 本地解析）
 * 此处负责 CLI、写 JSON/Excel；提取逻辑在 src/modules/process-pdf/core/extract-questions.ts。
 *
 * 使用：npm run parse:pdf <PDF路径> [输出路径]
 * 从 JSON 生成 Excel：npm run parse:pdf -- --json <JSON路径> [Excel路径]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { extractQuestionsFromPdf } from '../src/process-pdf';

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

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
	console.log('使用 process-pdf 模块提取题目（pdf-parse 本地解析）...\n');

	try {
		const questions = await extractQuestionsFromPdf(pdfPath);
		console.log('\n合计提取', questions.length, '道题目');
		saveJSON(questions, jsonPath);
		await generateExcel(questions, excelPath);
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
