import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import * as https from 'https';
import { lookup } from 'dns/promises';
import sanitizeHtml = require('sanitize-html');

const execute = promisify(execFile);
const IMAGE_HOSTS = new Set(['r1-ndr.ykt.cbern.com.cn', 'bdcs-file-1.ykt.cbern.com.cn', 'bdcs-file-2.ykt.cbern.com.cn']);
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let activeRenders = 0;

export function validateRenderInput(body: any) {
  if (!body || !Array.isArray(body.questions) || !body.questions.length || body.questions.length > 50) {
    throw new BadRequestException('每份练习纸请选择 1–50 题');
  }
  if (body.showAnswers !== undefined && typeof body.showAnswers !== 'boolean') throw new BadRequestException('答案开关格式不正确');
  if (body.space !== undefined && !['standard', 'large'].includes(body.space)) throw new BadRequestException('留白设置不正确');
  if (JSON.stringify(body).length > 500000) throw new BadRequestException('练习纸内容过大');
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 120)) throw new BadRequestException('标题最多 120 字');
  for (const question of body.questions) {
    if (!question || typeof question.prompt !== 'string' || !Array.isArray(question.options) || question.options.length > 26 || question.options.some(value => typeof value !== 'string')) {
      throw new BadRequestException('题目内容或选项格式不正确');
    }
    for (const key of ['answerHtml', 'explanation']) if (question[key] !== undefined && typeof question[key] !== 'string') throw new BadRequestException('答案格式不正确');
    if (question.answerIndices !== undefined && (!Array.isArray(question.answerIndices) || question.answerIndices.some(i => !Number.isInteger(i) || i < 0 || i >= question.options.length))) throw new BadRequestException('答案选项不正确');
  }
  return body;
}

// Resolve once and pin the connection to a public IPv4 address; redirects are never followed.
export async function downloadPrintImage(raw: string, timeoutMs = 15000): Promise<Buffer> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BadRequestException('题目图片地址无效'); }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new BadRequestException('该题含暂不支持打印的外部图片，请改用已核对的 PDF');
  const started = Date.now();
  let dnsTimer: ReturnType<typeof setTimeout>;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { all: true, family: 4 }),
      new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('图片地址解析超时')), Math.max(1, timeoutMs - (Date.now() - started))); }),
    ]);
  } finally { clearTimeout(dnsTimer); }
  const isPublic = (ip: string) => {
    const [a,b] = ip.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && a !== 198;
  };
  if (!addresses.length || addresses.some(item => !isPublic(item.address))) throw new BadRequestException('题目图片地址不可用');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup: ((_host: string, _opts: any, cb: any) => cb(null, addresses[0].address, 4)) as any }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new BadRequestException('题目图片读取失败，请稍后重试')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 3 * 1024 * 1024) request.destroy(new Error('图片超过 3 MB')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        const data = Buffer.concat(chunks);
        const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
        const gif = data.subarray(0,6).toString().match(/^GIF8[79]a$/);
        if (!png && !jpeg && !gif) reject(new BadRequestException('题目图片格式不支持，请改用已核对的 PDF'));
        else resolve(data);
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('图片读取超时')), Math.max(1, timeoutMs - (Date.now() - started)));
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

export async function renderQuestionsToPdf(input: any): Promise<Buffer> {
  const body = validateRenderInput(input);
  if (activeRenders >= 2) throw new ServiceUnavailableException('练习纸生成繁忙，请稍后重试');
  activeRenders++;
  const deadline = Date.now() + 50000;
  let folder: string;
  try {
    folder = await mkdtemp(join(tmpdir(), 'zhiye-print-'));
    const images = new Map<string, string>();
    const content = (value: string, rich: boolean) => {
      if (!rich) return escape(value).replace(/\n/g, '<br>');
      if (/<(?:audio|video|iframe|svg|math)\b/i.test(value) || /\\(?:frac|sqrt|begin|int|sum)\b/.test(value)) throw new BadRequestException('所选题含音视频或复杂公式，请上传已核对排版的 PDF');
      return sanitizeHtml(value, {
        allowedTags: ['p','div','span','br','b','strong','i','em','u','s','sub','sup','ul','ol','li','table','thead','tbody','tr','td','th','img'],
        allowedAttributes: { img: ['src'], td: ['colspan','rowspan'], th: ['colspan','rowspan'] },
        allowedSchemes: ['file'],
        transformTags: { img: (_tag, attrs) => {
          if (!attrs.src) throw new BadRequestException('题目图片缺少地址');
          if (!images.has(attrs.src)) {
            if (images.size >= 20) throw new BadRequestException('每份练习纸最多支持 20 张图片');
            images.set(attrs.src, join(folder, `image-${images.size}.png`));
          }
          return { tagName:'img', attribs:{ src:pathToFileURL(images.get(attrs.src)).href } };
        } },
      });
    };
    const questions = body.questions.map((question, index) => {
      const options = question.options.map((option, i) => `<p>${String.fromCharCode(65+i)}. ${content(option, question.rich)}</p>`).join('');
      return `<section><p><b>${index+1}.</b> ${content(question.prompt, question.rich)}</p>${options}<div style="height:${body.space === 'large' ? 100 : 40}px"></div></section>`;
    }).join('');
    const answers = body.showAnswers ? '<h2 style="page-break-before:always">参考答案</h2>' + body.questions.map((q,i) => {
      const indices = q.answerIndices?.length ? q.answerIndices : (Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length ? [q.answer] : []);
      const answer = q.answerHtml ? content(q.answerHtml, true) : indices.map(n => String.fromCharCode(65+n)).join('、');
      return `<section><b>${i+1}.</b> ${answer || '请自行核对原题答案'}${q.explanation ? `<p>${content(q.explanation, q.rich)}</p>` : ''}</section>`;
    }).join('') : '';
    for (const [url, path] of images) {
      const remaining = deadline - Date.now() - 10000;
      if (remaining <= 0) throw new ServiceUnavailableException('图片加载超时，请减少题量或上传 PDF');
      await writeFile(path, await downloadPrintImage(url, Math.min(15000, remaining)));
    }
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:"WenQuanYi Zen Hei","STHeiti","Songti SC","PingFang SC",sans-serif;font-size:12pt;color:#182638}h1{text-align:center;font-size:20pt}section{margin:14pt 0;page-break-inside:avoid}img{max-width:550px;max-height:650px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:4px}</style></head><body><h1>${escape(body.title || '知页练习纸')}</h1><p>姓名：____________　日期：____________</p>${questions}${answers}</body></html>`;
    const source = join(folder,'practice.html');
    await writeFile(source, html);
    await execute('soffice', [`-env:UserInstallation=${pathToFileURL(join(folder,'profile')).href}`, '--headless','--convert-to','pdf:writer_pdf_Export','--outdir',folder,source], { timeout:Math.max(1, Math.min(45000, deadline - Date.now())), maxBuffer:1024*1024 });
    const pdf = await readFile(join(folder,'practice.pdf'));
    if (!pdf.subarray(0,5).equals(Buffer.from('%PDF-')) || pdf.length > 50*1024*1024) throw new Error('Invalid PDF output');
    return pdf;
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException('练习纸暂时无法生成，请稍后重试或上传 PDF');
  } finally {
    try { if (folder) await rm(folder, { recursive:true, force:true }); } finally { activeRenders--; }
  }
}
