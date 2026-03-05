/**
 * 测试 PDF 题目提取（文本解析 + 图片 PDF OCR）
 * 用法：npx ts-node -r tsconfig-paths/register scripts/test-pdf-ocr.ts [PDF路径] [OCR最多页数]
 * 示例：npx ts-node -r tsconfig-paths/register scripts/test-pdf-ocr.ts test-files/普通心理学.pdf 3
 * 需配置环境变量 SILICON_FLOW_API_KEY（走 OCR 时使用）
 */
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

// 从项目根加载 .env / .env.local
const envPaths = [path.join(process.cwd(), '.env.local'), path.join(process.cwd(), '.env')];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    break;
  }
}

const pdfPathArg = process.argv[2] || 'test-files/普通心理学.pdf';
const maxOcrPagesArg = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
const pdfPath = path.isAbsolute(pdfPathArg) ? pdfPathArg : path.join(process.cwd(), pdfPathArg);

const SILICON_FLOW_BASE = 'https://api.siliconflow.cn/v1';
const OCR_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5';
const OCR_PROMPT =
  '<image>\n<|grounding|>请对图片进行OCR识别，保留原文排版和换行，直接输出识别出的文字，不要额外说明。';

/** 用 Ghostscript 将 PDF 指定页转为 PNG base64（当 pdf2pic 无图时使用） */
async function pdfPageToBase64WithGs(pdfPath: string, pageNum: number): Promise<string> {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const os = require('os');
  const execFileAsync = promisify(execFile);
  const outDir = path.join(os.tmpdir(), `pdf-ocr-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outPrefix = path.join(outDir, 'page');
  try {
    await execFileAsync('gs', [
      '-dNOPAUSE',
      '-dBATCH',
      '-sDEVICE=png16m',
      '-r150',
      `-dFirstPage=${pageNum}`,
      `-dLastPage=${pageNum}`,
      `-sOutputFile=${outPrefix}-%d.png`,
      pdfPath,
    ], { maxBuffer: 50 * 1024 * 1024 });
    const outFile = path.join(outDir, `page-${pageNum}.png`);
    if (fs.existsSync(outFile)) {
      const buf = fs.readFileSync(outFile);
      return buf.toString('base64');
    }
    return '';
  } finally {
    try {
      const files = fs.readdirSync(outDir);
      files.forEach((f) => fs.unlinkSync(path.join(outDir, f)));
      fs.rmdirSync(outDir);
    } catch (_) {}
  }
}

async function ocrImageBase64(imageBase64: string): Promise<string> {
  const apiKey = process.env.SILICON_FLOW_API_KEY;
  if (!apiKey) throw new Error('未配置 SILICON_FLOW_API_KEY');
  const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
  const res = await axios.post(
    `${SILICON_FLOW_BASE}/chat/completions`,
    {
      model: OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
      max_tokens: 4096,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    },
  );
  const content = res.data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.error('文件不存在:', pdfPath);
    process.exit(1);
  }
  console.log('PDF 路径:', pdfPath);
  console.log('OCR 最多页数:', maxOcrPagesArg ?? '全部');
  console.log('---');

  const {
    extractQuestions,
    getPdfPageCount,
    parseQuestionsFromText,
  } = require('../src/modules/process-pdf/core/extract-questions');
  const { fromPath } = require('pdf2pic');

  // 1) 先文本解析
  const textQuestions = await extractQuestions(pdfPath);
  if (textQuestions.length > 0) {
    console.log('[文本解析] 得到', textQuestions.length, '道题目');
    const outPath = pdfPath.replace(/\.pdf$/i, '-extract.json');
    fs.writeFileSync(outPath, JSON.stringify(textQuestions, null, 2), 'utf-8');
    console.log('已写入:', outPath);
    return;
  }

  console.log('[文本解析] 无结果，走 OCR...');
  const apiKey = process.env.SILICON_FLOW_API_KEY;
  if (!apiKey) {
    console.error('请设置环境变量 SILICON_FLOW_API_KEY 后重试');
    process.exit(1);
  }

  const numPages = await getPdfPageCount(pdfPath);
  console.log('总页数:', numPages);
  const pagesToRun = maxOcrPagesArg ? Math.min(maxOcrPagesArg, numPages) : numPages;
  if (pagesToRun <= 0) {
    console.log('无有效页数');
    return;
  }

  const convert = fromPath(pdfPath, { format: 'png', width: 1200, density: 150 });
  const textParts: string[] = [];
  for (let p = 1; p <= pagesToRun; p++) {
    process.stdout.write(`  OCR 第 ${p}/${pagesToRun} 页...`);
    let base64 = '';
    const result = await convert(p, { responseType: 'base64' });
    base64 = (result?.base64 ?? result?.base64Image ?? '').trim();
    if (!base64) {
      try {
        base64 = await pdfPageToBase64WithGs(pdfPath, p);
      } catch (e: any) {
        console.log(' 无图(pdf2pic 与 gs 均失败:', e?.message || e, ')');
        continue;
      }
    }
    if (!base64) {
      console.log(' 无图');
      continue;
    }
    const pageText = await ocrImageBase64(base64);
    if (pageText) textParts.push(pageText);
    console.log(' 完成');
  }

  const fullText = textParts.join('\n\n');
  const questions = parseQuestionsFromText(fullText);
  console.log('[OCR 解析] 得到', questions.length, '道题目');

  const outPath = pdfPath.replace(/\.pdf$/i, '-extract.json');
  fs.writeFileSync(outPath, JSON.stringify(questions, null, 2), 'utf-8');
  console.log('已写入:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
