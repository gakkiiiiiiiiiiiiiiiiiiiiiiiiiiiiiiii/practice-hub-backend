#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { promisify } = require('util');
const OSS = require('ali-oss');
const { loadEnv, required } = require('./env');

const execFileAsync = promisify(execFile);
const env = loadEnv();
const apiBase = required(env, 'WORKER_API_BASE_URL').replace(/\/$/, '');
const workerToken = required(env, 'PREVIEW_WORKER_TOKEN');
const stateFile = env.WORKER_STATE_FILE || '/var/lib/practice-hub-worker/preview-state.json';
const maxJobsPerRun = Math.max(1, Number(env.PREVIEW_MAX_JOBS_PER_RUN || 5));
const pageWidth = Math.max(720, Number(env.PREVIEW_IMAGE_WIDTH || 1440));
const jpegQuality = Math.min(95, Math.max(60, Number(env.PREVIEW_IMAGE_QUALITY || 90)));
const allowedSourceHosts = new Set(
  String(env.PREVIEW_ALLOWED_SOURCE_HOSTS || 'cdn.ltzm.me')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const oss = new OSS({
  region: env.OSS_REGION || 'oss-cn-shanghai',
  endpoint: env.OSS_INTERNAL_ENDPOINT || 'https://oss-cn-shanghai-internal.aliyuncs.com',
  bucket: required(env, 'OSS_BUCKET'),
  accessKeyId: required(env, 'OSS_ACCESS_KEY_ID'),
  accessKeySecret: required(env, 'OSS_ACCESS_KEY_SECRET'),
  secure: true,
  timeout: 10 * 60 * 1000,
});

function loadState() {
  if (!fs.existsSync(stateFile)) return { completed: {}, updatedAt: null };
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      completed: state.completed && typeof state.completed === 'object' ? state.completed : {},
      updatedAt: state.updatedAt || null,
    };
  } catch {
    return { completed: {}, updatedAt: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmpPath = `${stateFile}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmpPath, stateFile);
}

async function api(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      'x-preview-worker-token': workerToken,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`工作节点接口返回非 JSON 响应: HTTP ${response.status}`);
  }
  if (!response.ok || Number(payload.code || response.status) >= 400) {
    throw new Error(payload.message || `工作节点接口 HTTP ${response.status}`);
  }
  return payload.data ?? payload;
}

function decodeObjectKey(url) {
  const parsed = new URL(url);
  if (!allowedSourceHosts.has(parsed.hostname.toLowerCase())) return null;
  return parsed.pathname
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/');
}

async function objectExists(key) {
  try {
    await oss.head(key);
    return true;
  } catch (error) {
    if (error.status === 404 || error.code === 'NoSuchKey') return false;
    throw error;
  }
}

async function downloadSource(job, pdfPath) {
  const objectKey = decodeObjectKey(job.fileUrl);
  if (!objectKey) {
    return { skipped: true, reason: 'source_not_on_oss' };
  }
  await oss.get(objectKey, pdfPath);
  return { skipped: false, objectKey };
}

async function readPdfPageCount(pdfPath) {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 2 * 60 * 1000,
  });
  const count = Number.parseInt(String(stdout).match(/^Pages:\s+(\d+)/m)?.[1] || '', 10);
  if (!Number.isInteger(count) || count <= 0 || count > 20000) {
    throw new Error('无法读取 PDF 页数');
  }
  return count;
}

async function renderPage(pdfPath, pageNum, outputPrefix) {
  await execFileAsync(
    'pdftocairo',
    [
      '-jpeg',
      '-singlefile',
      '-f',
      String(pageNum),
      '-l',
      String(pageNum),
      '-scale-to-x',
      String(pageWidth),
      '-scale-to-y',
      '-1',
      '-jpegopt',
      `quality=${jpegQuality}`,
      pdfPath,
      outputPrefix,
    ],
    {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    },
  );
  const outputPath = `${outputPrefix}.jpg`;
  const stat = fs.statSync(outputPath);
  if (stat.size < 1024) throw new Error(`第 ${pageNum} 页转图结果异常`);
  return outputPath;
}

async function uploadPreviewPage(outputPath, keys) {
  for (const key of keys) {
    if (await objectExists(key)) continue;
    await oss.put(key, outputPath, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }
}

async function processJob(job) {
  const signature = `${job.fileId}:${job.pageCountVersion}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `preview-worker-${job.fileId}-`));
  const pdfPath = path.join(tmpDir, 'source.pdf');
  try {
    const source = await downloadSource(job, pdfPath);
    if (source.skipped) return { signature, skipped: true, reason: source.reason };

    const pageCount = await readPdfPageCount(pdfPath);
    const pagesToWarm = Math.min(pageCount, Math.max(1, Number(job.prewarmPages || 3)));
    let generated = 0;
    let skipped = 0;
    for (let pageNum = 1; pageNum <= pagesToWarm; pageNum += 1) {
      const keys = [
        `${job.fullCachePrefix}/${pageNum}.jpg`,
        `${job.trialCachePrefix}/${pageNum}.jpg`,
      ];
      const existing = await Promise.all(keys.map(objectExists));
      if (existing.every(Boolean)) {
        skipped += 1;
        continue;
      }
      const outputPath = await renderPage(pdfPath, pageNum, path.join(tmpDir, `page-${pageNum}`));
      await uploadPreviewPage(outputPath, keys);
      generated += 1;
    }

    await api('/api/internal/preview-worker/results', {
      method: 'POST',
      body: JSON.stringify({
        fileId: job.fileId,
        fileUrl: job.fileUrl,
        pageCount,
        pageCountVersion: job.pageCountVersion,
      }),
    });
    return { signature, skipped: false, pageCount, generated, cached: skipped };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function run() {
  await api('/api/internal/preview-worker/health');
  const state = loadState();
  let cursor = 0;
  let processed = 0;
  let scanned = 0;
  const failures = [];

  while (processed < maxJobsPerRun) {
    const page = await api(
      `/api/internal/preview-worker/jobs?cursor=${cursor}&limit=50`,
    );
    const jobs = Array.isArray(page.jobs) ? page.jobs : [];
    if (jobs.length === 0) break;
    for (const job of jobs) {
      cursor = Number(job.fileId) || cursor;
      scanned += 1;
      const signature = `${job.fileId}:${job.pageCountVersion}`;
      if (state.completed[signature]) continue;
      try {
        const result = await processJob(job);
        if (result.skipped) {
          console.log(`[跳过] file=${job.fileId} reason=${result.reason}`);
          continue;
        }
        state.completed[signature] = {
          completedAt: new Date().toISOString(),
          pageCount: result.pageCount,
        };
        saveState(state);
        processed += 1;
        console.log(
          `[完成] file=${job.fileId} pages=${result.pageCount} generated=${result.generated} cached=${result.cached}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ fileId: job.fileId, message });
        console.error(`[失败] file=${job.fileId}: ${message}`);
      }
      if (processed >= maxJobsPerRun) break;
    }
    if (!page.hasMore) break;
  }

  console.log(
    JSON.stringify({
      completed: failures.length === 0,
      scanned,
      processed,
      failures,
    }),
  );
  if (failures.length > 0) process.exitCode = 2;
}

run().catch((error) => {
  console.error(`[工作节点终止] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
