import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { ProcessPdfService } from './process-pdf.service';
import type { ExtractedQuestion } from './core/extract-questions';

export type PdfExtractTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface PdfExtractTask {
  taskId: string;
  status: PdfExtractTaskStatus;
  forceOcr?: boolean;
  result?: { count: number; data: ExtractedQuestion[] };
  error?: string;
  createdAt: number;
}

const TASKS_DIR = path.join(os.tmpdir(), 'process-pdf-tasks');
const TASK_FILE = 'upload.pdf';

@Injectable()
export class PdfExtractQueueService {
  private readonly tasks = new Map<string, PdfExtractTask>();
  private readonly queue: string[] = [];
  private processing = false;

  constructor(private readonly processPdfService: ProcessPdfService) {}

  /**
   * 提交 PDF 提取任务，立即返回 taskId；实际处理在后台队列执行
   */
  async submit(file: Express.Multer.File, forceOcr: boolean): Promise<{ taskId: string }> {
    if (!file?.path && !file?.buffer) {
      throw new Error('未收到 PDF 文件');
    }
    const taskId = randomUUID();
    const taskDir = path.join(TASKS_DIR, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const pdfPath = path.join(taskDir, TASK_FILE);
    if (file.buffer && file.buffer.length > 0) {
      fs.writeFileSync(pdfPath, Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer));
    } else if (file.path && fs.existsSync(file.path)) {
      fs.copyFileSync(file.path, pdfPath);
    } else {
      fs.rmdirSync(taskDir, { recursive: true });
      throw new Error('无法读取上传文件');
    }
    const task: PdfExtractTask = {
      taskId,
      status: 'pending',
      forceOcr,
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.queue.push(taskId);
    setImmediate(() => this.processNext());
    return { taskId };
  }

  getTask(taskId: string): PdfExtractTask | undefined {
    return this.tasks.get(taskId);
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    const taskId = this.queue.shift()!;
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') return;
    this.processing = true;
    task.status = 'processing';
    const taskDir = path.join(TASKS_DIR, taskId);
    const pdfPath = path.join(taskDir, TASK_FILE);
    try {
      if (!fs.existsSync(pdfPath)) {
        task.status = 'failed';
        task.error = '任务文件已失效';
      } else {
        const file = {
          path: pdfPath,
          buffer: undefined,
          originalname: 'upload.pdf',
        } as Express.Multer.File;
        const questions = await this.processPdfService.extractQuestions(file, {
          forceOcr: task.forceOcr,
        });
        task.status = 'completed';
        task.result = { count: questions.length, data: questions };
      }
    } catch (err: any) {
      task.status = 'failed';
      task.error = err?.message || String(err);
    } finally {
      try {
        if (fs.existsSync(taskDir)) {
          const files = fs.readdirSync(taskDir);
          files.forEach((f) => fs.unlinkSync(path.join(taskDir, f)));
          fs.rmdirSync(taskDir);
        }
      } catch (_) {}
      this.processing = false;
      if (this.queue.length > 0) setImmediate(() => this.processNext());
    }
  }
}
