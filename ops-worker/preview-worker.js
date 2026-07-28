#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { promisify } = require('util');
const { loadEnv, required } = require('./env');

const execFileAsync = promisify(execFile);
const env = loadEnv();
const apiBase = required(env, 'WORKER_API_BASE_URL').replace(/\/$/, '');
const workerToken = required(env, 'PREVIEW_WORKER_TOKEN');
const stateFile = env.WORKER_STATE_FILE || '/var/lib/practice-hub-worker/preview-state.json';
const maxJobsPerRun = Math.max(1, Number(env.PREVIEW_MAX_JOBS_PER_RUN || 1));
const pageWidth = Math.max(720, Number(env.PREVIEW_IMAGE_WIDTH || 1440));
const jpegQuality = Math.min(95, Math.max(60, Number(env.PREVIEW_IMAGE_QUALITY || 90)));

function loadState() {
  if (!fs.existsSync(stateFile)) return { completed: {}, inProgress: {}, updatedAt: null };
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      completed: state.completed && typeof state.completed === 'object' ? state.completed : {},
      inProgress: state.inProgress && typeof state.inProgress === 'object' ? state.inProgress : {},
      updatedAt: state.updatedAt || null,
    };
  } catch {
    return { completed: {}, inProgress: {}, updatedAt: null };
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

async function downloadSource(job, pdfPath) {
  if (!job.sourceUrl) {
    return { skipped: true, reason: 'source_not_on_oss' };
  }
  const response = await fetch(job.sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`下载 PDF 失败: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(pdfPath));
  return { skipped: false };
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

async function getUploadTargets(job, pageNum) {
  return api('/api/internal/preview-worker/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileId: job.fileId,
      fileUrl: job.fileUrl,
      pageCountVersion: job.pageCountVersion,
      pageNum,
    }),
  });
}

async function uploadPreviewPage(targets, outputPath) {
  const body = fs.readFileSync(outputPath);
  for (const upload of targets) {
    const response = await fetch(upload.url, {
      method: upload.method || 'PUT',
      headers: upload.headers || { 'Content-Type': 'image/jpeg' },
      body,
    });
    if (!response.ok) {
      throw new Error(`上传预览图失败: HTTP ${response.status}`);
    }
  }
}

async function reportPageCount(job, pageCount) {
  await api('/api/internal/preview-worker/results', {
    method: 'POST',
    body: JSON.stringify({
      fileId: job.fileId,
      fileUrl: job.fileUrl,
      pageCount,
      pageCountVersion: job.pageCountVersion,
    }),
  });
}

async function processJob(job, state) {
  const signature = `${job.fileId}:${job.pageCountVersion}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `preview-worker-${job.fileId}-`));
  const pdfPath = path.join(tmpDir, 'source.pdf');
  try {
    const source = await downloadSource(job, pdfPath);
    if (source.skipped) return { signature, skipped: true, reason: source.reason };

    const pageCount = await readPdfPageCount(pdfPath);
    await reportPageCount(job, pageCount);
    const resume = state.inProgress[signature];
    const startPage =
      resume && Number(resume.pageCount) === pageCount
        ? Math.min(pageCount + 1, Math.max(1, Number(resume.nextPage) || 1))
        : 1;
    let generated = 0;
    let skipped = 0;
    for (let pageNum = startPage; pageNum <= pageCount; pageNum += 1) {
      const signed = await getUploadTargets(job, pageNum);
      const missingTargets = (signed.uploads || []).filter((upload) => !upload.exists);
      if (missingTargets.length === 0) {
        skipped += 1;
      } else {
        const outputPath = await renderPage(pdfPath, pageNum, path.join(tmpDir, `page-${pageNum}`));
        await uploadPreviewPage(missingTargets, outputPath);
        generated += 1;
        fs.rmSync(outputPath, { force: true });
      }
      state.inProgress[signature] = {
        nextPage: pageNum + 1,
        pageCount,
        updatedAt: new Date().toISOString(),
      };
      saveState(state);
      if (pageNum === 1 || pageNum % 10 === 0 || pageNum === pageCount) {
        console.log(
          `[进度] file=${job.fileId} page=${pageNum}/${pageCount} generated=${generated} cached=${skipped}`,
        );
      }
    }

    delete state.inProgress[signature];
    saveState(state);
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
      if (state.completed[signature] && job.cacheComplete) continue;
      if (state.completed[signature] && !job.cacheComplete) {
        delete state.completed[signature];
        delete state.inProgress[signature];
        saveState(state);
      }
      try {
        const result = await processJob(job, state);
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
