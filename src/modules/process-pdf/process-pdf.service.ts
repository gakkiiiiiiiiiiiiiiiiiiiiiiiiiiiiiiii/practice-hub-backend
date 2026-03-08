import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import mammoth from 'mammoth';
import { extractQuestions, parseQuestionsFromText, ExtractedQuestion } from './core/extract-questions';
import { PaddleOcrAistudioService } from './paddle-ocr-aistudio.service';

/** 部分解析成功时抛出，携带已解析题目供队列写入 */
export class PartialResultError extends Error {
	constructor(
		public readonly partialQuestions: ExtractedQuestion[],
		message: string,
	) {
		super(message);
		this.name = 'PartialResultError';
	}
}

@Injectable()
export class ProcessPdfService {
	constructor(private readonly paddleOcrAistudio: PaddleOcrAistudioService) {}

	/**
	 * 从上传的 PDF 文件中提取题目。
	 * 默认：先文本解析，若无结果则走 PaddleOCR Aistudio 直接上传 PDF OCR。
	 * forceOcr=true 时：跳过文本解析，直接上传 PDF 到 PaddleOCR Aistudio 进行 OCR。
	 */
	async extractQuestions(file: Express.Multer.File, options?: { forceOcr?: boolean }): Promise<ExtractedQuestion[]> {
		if (!file?.path && !file?.buffer) {
			throw new BadRequestException('未收到 PDF 文件');
		}

		const forceOcr = options?.forceOcr === true;
		let pdfPath: string | null = null;
		try {
			if (file.path && fs.existsSync(file.path)) {
				pdfPath = file.path;
			} else if (file.buffer && file.buffer.length > 0) {
				const tmpDir = path.join(os.tmpdir(), 'process-pdf-upload-' + Date.now());
				fs.mkdirSync(tmpDir, { recursive: true });
				pdfPath = path.join(tmpDir, file.originalname || 'upload.pdf');
				fs.writeFileSync(pdfPath, file.buffer);
			}
			if (!pdfPath || !pdfPath.toLowerCase().endsWith('.pdf')) {
				throw new BadRequestException('请上传 PDF 文件');
			}

			if (forceOcr) {
				const ocrResult = await this.extractQuestionsViaOcr(pdfPath);
				if (ocrResult.partialError && ocrResult.questions.length > 0) {
					throw new PartialResultError(ocrResult.questions, ocrResult.partialError);
				}
				if (ocrResult.partialError && ocrResult.questions.length === 0) {
					throw new BadRequestException(ocrResult.partialError);
				}
				return ocrResult.questions;
			}

			let questions = await extractQuestions(pdfPath);
			if (questions.length === 0) {
				try {
					const ocrResult = await this.extractQuestionsViaOcr(pdfPath);
					if (ocrResult.partialError && ocrResult.questions.length > 0) {
						throw new PartialResultError(ocrResult.questions, ocrResult.partialError);
					}
					if (ocrResult.partialError && ocrResult.questions.length === 0) {
						throw new BadRequestException(ocrResult.partialError);
					}
					questions = ocrResult.questions;
				} catch (ocrErr: any) {
					if (ocrErr instanceof PartialResultError) throw ocrErr;
					const msg = ocrErr?.message || String(ocrErr);
					const hint = msg.includes('PADDLE_API_KEY')
						? '请配置环境变量 PADDLE_API_KEY（PaddleOCR Aistudio 的 token）。'
						: '';
					throw new BadRequestException(`PDF 文本提取无结果，且图片 OCR 失败。${hint ? hint + ' ' : ''}${msg}`);
				}
			}
			return questions;
		} finally {
			if (pdfPath && pdfPath.includes('process-pdf-upload-')) {
				try {
					fs.unlinkSync(pdfPath);
					const dir = path.dirname(pdfPath);
					if (fs.readdirSync(dir).length === 0) {
						fs.rmdirSync(dir);
					}
				} catch (_) {}
			}
		}
	}

	/**
	 * 图片型 PDF：直接上传 PDF 到 PaddleOCR Aistudio 进行 OCR，再解析题目
	 */
	private async extractQuestionsViaOcr(
		pdfPath: string,
	): Promise<{ questions: ExtractedQuestion[]; partialError?: string }> {
		const fullText = await this.paddleOcrAistudio.extractTextFromPdf(pdfPath);
		if (!fullText.trim()) {
			return { questions: [] };
		}
		const questions = parseQuestionsFromText(fullText);
		return { questions };
	}

	/**
	 * 从上传的 Word（.docx）文件中提取题目（mammoth 转文本 + 同一解析规则）
	 */
	async extractQuestionsFromWord(file: Express.Multer.File): Promise<ExtractedQuestion[]> {
		if (!file?.buffer && !file?.path) {
			throw new BadRequestException('未收到 Word 文件');
		}
		let buffer: Buffer;
		if (file.buffer && file.buffer.length > 0) {
			buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
		} else if (file.path && fs.existsSync(file.path)) {
			buffer = fs.readFileSync(file.path);
		} else {
			throw new BadRequestException('请上传 Word 文件（.docx）');
		}
		const name = (file.originalname || file.path || '').toLowerCase();
		if (!name.endsWith('.docx') && !name.endsWith('.doc')) {
			throw new BadRequestException('仅支持 .docx 或 .doc 格式');
		}

		const { value } = await mammoth.extractRawText({ buffer });
		const text = (value || '').trim();
		if (!text) {
			throw new BadRequestException('Word 文件中未解析出文字');
		}
		return parseQuestionsFromText(text);
	}
}
