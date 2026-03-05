import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromPath } = require('pdf2pic');
import {
  extractQuestions,
  getPdfPageCount,
  parseQuestionsFromText,
  ExtractedQuestion,
} from './core/extract-questions';
import { SiliconFlowOcrService } from './silicon-flow-ocr.service';

@Injectable()
export class ProcessPdfService {
  constructor(private readonly siliconFlowOcr: SiliconFlowOcrService) {}

  /**
   * 从上传的 PDF 文件中提取题目：先文本解析，若无结果则走图片 PDF OCR（硅基流动 PaddleOCR-VL-1.5）
   */
  async extractQuestions(file: Express.Multer.File): Promise<ExtractedQuestion[]> {
    if (!file?.path && !file?.buffer) {
      throw new BadRequestException('未收到 PDF 文件');
    }

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

      let questions = await extractQuestions(pdfPath);
      if (questions.length === 0) {
        try {
          questions = await this.extractQuestionsViaOcr(pdfPath);
        } catch (ocrErr: any) {
          throw new BadRequestException(
            ocrErr?.message || 'PDF 文本提取无结果，且图片 OCR 失败，请确认已配置 SILICON_FLOW_API_KEY 或上传含可选中文字的 PDF',
          );
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
   * 图片型 PDF：按页转图片后调用硅基流动 PaddleOCR-VL-1.5 识别，再解析题目
   */
  private async extractQuestionsViaOcr(pdfPath: string): Promise<ExtractedQuestion[]> {
    const numPages = await getPdfPageCount(pdfPath);
    if (numPages <= 0) return [];

    const convert = fromPath(pdfPath, {
      format: 'png',
      width: 1200,
      density: 150,
    });
    const textParts: string[] = [];
    for (let p = 1; p <= numPages; p++) {
      const result = await convert(p, { responseType: 'base64' });
      const base64 = result?.base64 ?? result?.base64Image ?? '';
      if (base64) {
        const pageText = await this.siliconFlowOcr.ocrImageBase64(base64);
        if (pageText) textParts.push(pageText);
      }
    }
    const fullText = textParts.join('\n\n');
    return parseQuestionsFromText(fullText);
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
