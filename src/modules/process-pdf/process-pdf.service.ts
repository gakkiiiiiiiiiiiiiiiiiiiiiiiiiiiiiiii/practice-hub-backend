import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractQuestions } from './core/extract-questions';

@Injectable()
export class ProcessPdfService {
  /**
   * 从上传的 PDF 文件中提取题目（pdf-parse 本地解析）
   */
  async extractQuestions(file: Express.Multer.File): Promise<any[]> {
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
      return await extractQuestions(pdfPath);
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
}
