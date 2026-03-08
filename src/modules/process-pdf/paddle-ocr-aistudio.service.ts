import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
// form-data 为 CommonJS，使用 require 避免 "default is not a constructor"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');

const JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
const MODEL = 'PaddleOCR-VL-1.5';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟

const OPTIONAL_PAYLOAD = {
	useDocOrientationClassify: false,
	useDocUnwarping: false,
	useChartRecognition: false,
};

@Injectable()
export class PaddleOcrAistudioService {
	private readonly logger = new Logger(PaddleOcrAistudioService.name);

	constructor(private readonly configService: ConfigService) {}

	getToken(): string | undefined {
		return this.configService.get<string>('PADDLE_API_KEY');
	}

	/**
	 * 直接上传 PDF 文件到 PaddleOCR Aistudio，轮询完成后解析 JSONL 得到全文
	 */
	async extractTextFromPdf(pdfPath: string): Promise<string> {
		const token = this.getToken();
		if (!token || !String(token).trim()) {
			throw new Error('未配置 PADDLE_API_KEY，无法使用 PDF OCR 功能');
		}
		if (!fs.existsSync(pdfPath)) {
			throw new Error(`PDF 文件不存在: ${pdfPath}`);
		}

		const jobId = await this.submitJob(pdfPath, token);
		this.logger.log(`[PaddleOCR Aistudio] 任务已提交: jobId=${jobId}`);
		const jsonUrl = await this.pollUntilDone(jobId, token);
		const fullText = await this.fetchJsonlAndExtractText(jsonUrl);
		return fullText;
	}

	private async submitJob(pdfPath: string, token: string): Promise<string> {
		const form = new FormData();
		form.append('file', fs.createReadStream(pdfPath), {
			filename: path.basename(pdfPath) || 'upload.pdf',
		});
		form.append('model', MODEL);
		form.append('optionalPayload', JSON.stringify(OPTIONAL_PAYLOAD));

		try {
			const res = await axios.post(JOB_URL, form, {
				headers: {
					Authorization: `bearer ${token}`,
					...form.getHeaders(),
				},
				timeout: 120000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
				validateStatus: () => true,
			});
			if (res.status !== 200) {
				const body = res.data ? JSON.stringify(res.data) : res.statusText;
				this.logger.warn(`[PaddleOCR Aistudio] 提交任务失败: status=${res.status}, body=${body}`);
				throw new Error(`提交任务失败: ${res.status} ${res.statusText}。${body || ''}`);
			}
			const jobId = res.data?.data?.jobId;
			if (!jobId) {
				throw new Error(`提交任务失败，未返回 jobId。响应: ${JSON.stringify(res.data)}`);
			}
			return jobId;
		} catch (e: any) {
			if (e?.response?.status) {
				const body = e.response?.data ? JSON.stringify(e.response.data) : '';
				throw new Error(`提交任务失败: HTTP ${e.response.status} ${e.response.statusText || ''}。${body}`);
			}
			throw e;
		}
	}

	private async pollUntilDone(jobId: string, token: string): Promise<string> {
		const start = Date.now();
		while (Date.now() - start < POLL_TIMEOUT_MS) {
			const res = await axios.get(`${JOB_URL}/${jobId}`, {
				headers: { Authorization: `bearer ${token}` },
				timeout: 30000,
			});
			if (res.status !== 200) {
				throw new Error(`查询任务失败: ${res.status}`);
			}
			const state = res.data?.data?.state;
			if (state === 'done') {
				const jsonUrl = res.data?.data?.resultUrl?.jsonUrl;
				if (!jsonUrl) {
					throw new Error('任务完成但未返回 resultUrl.jsonUrl');
				}
				return jsonUrl;
			}
			if (state === 'failed') {
				const errorMsg = res.data?.data?.errorMsg || '未知错误';
				throw new Error(`OCR 任务失败: ${errorMsg}`);
			}
			const progress = res.data?.data?.extractProgress;
			if (progress?.totalPages != null && progress?.extractedPages != null) {
				this.logger.log(`[PaddleOCR Aistudio] 任务进行中: ${progress.extractedPages}/${progress.totalPages} 页`);
			}
			await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		}
		throw new Error('OCR 任务轮询超时');
	}

	private async fetchJsonlAndExtractText(jsonUrl: string): Promise<string> {
		const res = await axios.get(jsonUrl, { timeout: 60000, responseType: 'text' });
		const text = typeof res.data === 'string' ? res.data : '';
		const lines = text
			.trim()
			.split('\n')
			.filter((l) => l.trim());
		const textParts: string[] = [];
		for (const line of lines) {
			try {
				const data = JSON.parse(line);
				const results = data?.result?.layoutParsingResults;
				if (Array.isArray(results)) {
					for (const r of results) {
						const md = r?.markdown?.text;
						if (typeof md === 'string' && md.trim()) {
							textParts.push(md.trim());
						}
					}
				}
			} catch (_) {
				// 忽略单行解析失败
			}
		}
		return textParts.join('\n\n');
	}
}
