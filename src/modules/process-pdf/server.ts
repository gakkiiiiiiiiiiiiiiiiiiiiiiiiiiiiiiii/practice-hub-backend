/**
 * 独立 HTTP 服务：上传 PDF 并提取题目（与 Nest 共用 core）
 * 运行：npm run build && node dist/modules/process-pdf/server.js
 * 或：npx ts-node -r tsconfig-paths/register src/modules/process-pdf/server.ts
 */
import * as express from 'express';
import * as cors from 'cors';
import * as multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { extractQuestions } from './core/extract-questions';

const app = express();
const port = 3000;

app.use(cors());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.post('/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file provided' });
  }
  const filePath = req.file.path;
  const originalName = req.file.originalname || 'file.pdf';
  try {
    const questions = await extractQuestions(filePath);
    fs.unlinkSync(filePath);
    res.json({ success: true, filename: originalName, count: questions.length, data: questions });
  } catch (error: any) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ success: false, error: 'Failed to process PDF', details: error?.message });
  }
});

app.listen(port, () => {
  console.log(`PDF Extraction Service at http://localhost:${port}`);
  console.log('- POST /upload (form field: pdf)');
  console.log('- GET  /health');
});
