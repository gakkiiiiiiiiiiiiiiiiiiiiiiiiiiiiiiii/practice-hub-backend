import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { ProcessPdfService } from './process-pdf.service';
import type { ExtractedQuestion } from './core/extract-questions';

export type PdfExtractTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface PdfExtractTask {
  taskId: string;
  status: PdfExtractTaskStatus;
  fileName?: string;
  fileUrl?: string;
  forceOcr?: boolean;
  progress?: string;
  result?: { count: number; data: ExtractedQuestion[] };
  error?: string;
  createdAt: number;
}

const TASKS_DIR = path.join(os.tmpdir(), 'process-pdf-tasks');
const TASK_FILE = 'upload.pdf';
const MAX_TASKS_KEEP = 100;

@Injectable()
export class PdfExtractQueueService {
  private readonly tasks = new Map<string, PdfExtractTask>();
  private readonly taskIdOrder: string[] = [];
  private readonly queue: string[] = [];
  private processing = false;

  constructor(private readonly processPdfService: ProcessPdfService) {}

  /**
   * 提交 PDF 提取任务（文件先已上传到对象存储），按 fileUrl 下载后解析
   */
  async submitByUrl(fileUrl: string, fileName: string, forceOcr: boolean): Promise<{ taskId: string; fileName: string }> {
    const taskId = randomUUID();
    const task: PdfExtractTask = {
      taskId,
      status: 'pending',
      fileName,
      fileUrl,
      forceOcr,
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.taskIdOrder.push(taskId);
    if (this.taskIdOrder.length > MAX_TASKS_KEEP) {
      const old = this.taskIdOrder.shift()!;
      this.tasks.delete(old);
    }
    this.queue.push(taskId);
    setImmediate(() => this.processNext());
    return { taskId, fileName };
  }

  /**
   * 直接提交文件（兼容旧流程，内部仍会先写临时文件再处理）
   */
  async submit(file: Express.Multer.File, forceOcr: boolean): Promise<{ taskId: string; fileName: string }> {
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
    const fileName = file.originalname || 'upload.pdf';
    const task: PdfExtractTask = {
      taskId,
      status: 'pending',
      fileName,
      forceOcr,
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.taskIdOrder.push(taskId);
    if (this.taskIdOrder.length > MAX_TASKS_KEEP) {
      const old = this.taskIdOrder.shift()!;
      this.tasks.delete(old);
    }
    this.queue.push(taskId);
    (task as any)._localPath = pdfPath;
    setImmediate(() => this.processNext());
    return { taskId, fileName };
  }

  getTask(taskId: string): PdfExtractTask | undefined {
    return this.tasks.get(taskId);
  }

  getRecentTasks(limit = 50): PdfExtractTask[] {
    const ids = this.taskIdOrder.slice(-limit).reverse();
    return ids.map((id) => this.tasks.get(id)).filter(Boolean) as PdfExtractTask[];
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    const taskId = this.queue.shift()!;
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') return;
    this.processing = true;
    task.status = 'processing';
    let pdfPath: string | null = null;
    const taskDir = path.join(TASKS_DIR, taskId);
    try {
      if (task.fileUrl) {
        const res = await axios.get(task.fileUrl, { responseType: 'arraybuffer', timeout: 300000 });
        fs.mkdirSync(taskDir, { recursive: true });
        pdfPath = path.join(taskDir, TASK_FILE);
        fs.writeFileSync(pdfPath, Buffer.from(res.data));
      } else {
        pdfPath = (task as any)._localPath || path.join(taskDir, TASK_FILE);
      }
      if (!pdfPath || !fs.existsSync(pdfPath)) {
        task.status = 'failed';
        task.error = '任务文件不存在';
      } else {
        const file = {
          path: pdfPath,
          buffer: undefined,
          originalname: task.fileName || 'upload.pdf',
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
      delete (task as any)._localPath;
      this.processing = false;
      if (this.queue.length > 0) setImmediate(() => this.processNext());
    }
  }
}
