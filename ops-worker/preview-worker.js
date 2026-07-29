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
const maxTrialJobsPerRun = Math.max(
  maxJobsPerRun,
  Number(env.PREVIEW_MAX_TRIAL_JOBS_PER_RUN || 20),
);
const startCursor = Math.max(0, Number(env.PREVIEW_START_CURSOR || 0));
const trialOnly = String(env.PREVIEW_TRIAL_ONLY || '').toLowerCase() === 'true';
const pageWidth = Math.max(720, Number(env.PREVIEW_IMAGE_WIDTH || 1440));
const jpegQuality = Math.min(95, Math.max(60, Number(env.PREVIEW_IMAGE_QUALITY || 90)));

class FatalWorkerError extends Error {}

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
    if (response.status === 403) {
      const errorBody = await response.text();
      const errorCode = errorBody.match(/<Code>([^<]+)/)?.[1] || '';
      if (errorCode === 'UserDisable') {
        throw new FatalWorkerError('OSS 账号当前不可用（UserDisable），已停止本轮任务');
      }
      throw new Error(`下载 PDF 失败: HTTP 403${errorCode ? ` (${errorCode})` : ''}`);
    }
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

async function normalizeSourceToPdf(job, sourcePath, tmpDir) {
  const fileType = String(job.fileType || 'pdf').toLowerCase();
  if (fileType === 'pdf') return sourcePath;
  if (!['doc', 'docx'].includes(fileType)) {
    throw new Error(`不支持的资料格式: ${fileType || 'unknown'}`);
  }
  await execFileAsync(
    'libreoffice',
    [
      '--headless',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      tmpDir,
      sourcePath,
    ],
    {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        HOME: tmpDir,
      },
    },
  );
  const pdfPath = path.join(
    tmpDir,
    `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`,
  );
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size < 1024) {
    throw new Error(`${fileType.toUpperCase()} 转 PDF 失败`);
  }
  return pdfPath;
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

async function isModeComplete(job, mode) {
  const reported = mode === 'trial' ? job.trialCacheComplete : job.fullCacheComplete;
  if (typeof reported === 'boolean') return reported;

  // 兼容尚未升级的业务后端：直接通过单页上传接口检查目标对象是否存在。
  const pageNum = mode === 'trial'
    ? Math.min(Math.max(0, Number(job.trialPages) || 0), Math.max(0, Number(job.cachedPageCount) || 0))
    : Math.max(0, Number(job.cachedPageCount) || 0);
  if (pageNum < 1 || String(job.cachedPageCountVersion || '') !== String(job.pageCountVersion || '')) {
    return false;
  }
  const signed = await getUploadTargets(job, pageNum);
  const expectedPrefix = mode === 'trial' ? job.trialCachePrefix : job.fullCachePrefix;
  const target = (signed.uploads || []).find((upload) =>
    String(upload.path || '').startsWith(`${expectedPrefix}/`),
  );
  return Boolean(target?.exists);
}

async function processJob(job, state, mode = 'full') {
  const signature = `${job.fileId}:${job.pageCountVersion}`;
  const progressSignature = mode === 'trial' ? `${signature}:trial` : signature;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `preview-worker-${job.fileId}-`));
  const fileType = ['pdf', 'doc', 'docx'].includes(String(job.fileType || '').toLowerCase())
    ? String(job.fileType).toLowerCase()
    : 'pdf';
  const sourcePath = path.join(tmpDir, `source.${fileType}`);
  try {
    const source = await downloadSource(job, sourcePath);
    if (source.skipped) return { signature, skipped: true, reason: source.reason };

    const pdfPath = await normalizeSourceToPdf(job, sourcePath, tmpDir);
    const pageCount = await readPdfPageCount(pdfPath);
    await reportPageCount(job, pageCount);
    const lastPage = mode === 'trial'
      ? Math.min(pageCount, Math.max(0, Number(job.trialPages) || 0))
      : pageCount;
    if (lastPage < 1) {
      return { signature: progressSignature, skipped: true, reason: 'trial_disabled' };
    }
    const resume = state.inProgress[progressSignature];
    const startPage =
      resume && Number(resume.pageCount) === pageCount
        ? Math.min(lastPage + 1, Math.max(1, Number(resume.nextPage) || 1))
        : 1;
    let generated = 0;
    let skipped = 0;
    for (let pageNum = startPage; pageNum <= lastPage; pageNum += 1) {
      const signed = await getUploadTargets(job, pageNum);
      const missingTargets = (signed.uploads || []).filter((upload) => {
        if (upload.exists) return false;
        if (mode !== 'trial') return true;
        return String(upload.path || '').startsWith(`${job.trialCachePrefix}/`)
          || String(upload.path || '').startsWith(`${job.fullCachePrefix}/`);
      });
      if (missingTargets.length === 0) {
        skipped += 1;
      } else {
        const outputPath = await renderPage(pdfPath, pageNum, path.join(tmpDir, `page-${pageNum}`));
        await uploadPreviewPage(missingTargets, outputPath);
        generated += 1;
        fs.rmSync(outputPath, { force: true });
      }
      state.inProgress[progressSignature] = {
        nextPage: pageNum + 1,
        pageCount,
        mode,
        updatedAt: new Date().toISOString(),
      };
      saveState(state);
      if (pageNum === 1 || pageNum % 10 === 0 || pageNum === lastPage) {
        console.log(
          `[进度] mode=${mode} file=${job.fileId} page=${pageNum}/${lastPage} generated=${generated} cached=${skipped}`,
        );
      }
    }

    delete state.inProgress[progressSignature];
    saveState(state);
    return { signature: progressSignature, skipped: false, pageCount, generated, cached: skipped };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runPass(state, mode, maxAttempts, initialCursor = 0) {
  let cursor = initialCursor;
  let processed = 0;
  let attempted = 0;
  let scanned = 0;
  const failures = [];

  while (attempted < maxAttempts) {
    const page = await api(
      `/api/internal/preview-worker/jobs?cursor=${cursor}&limit=50`,
    );
    const jobs = Array.isArray(page.jobs) ? page.jobs : [];
    if (jobs.length === 0) break;
    for (const job of jobs) {
      cursor = Number(job.fileId) || cursor;
      scanned += 1;
      const signature = `${job.fileId}:${job.pageCountVersion}`;
      const progressSignature = mode === 'trial' ? `${signature}:trial` : signature;
      const modeComplete = await isModeComplete(job, mode);
      if (modeComplete) continue;
      if (state.completed[progressSignature] && !modeComplete) {
        delete state.completed[progressSignature];
        delete state.inProgress[progressSignature];
        saveState(state);
      }
      attempted += 1;
      try {
        const result = await processJob(job, state, mode);
        if (result.skipped) {
          console.log(`[跳过] mode=${mode} file=${job.fileId} reason=${result.reason}`);
          continue;
        }
        state.completed[progressSignature] = {
          completedAt: new Date().toISOString(),
          pageCount: result.pageCount,
          mode,
        };
        saveState(state);
        processed += 1;
        console.log(
          `[完成] mode=${mode} file=${job.fileId} pages=${result.pageCount} generated=${result.generated} cached=${result.cached}`,
        );
      } catch (error) {
        if (error instanceof FatalWorkerError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ fileId: job.fileId, message });
        console.error(`[失败] file=${job.fileId}: ${message}`);
      }
      if (attempted >= maxAttempts) break;
    }
    if (!page.hasMore) break;
  }

  return { mode, scanned, attempted, processed, failures };
}

async function run() {
  await api('/api/internal/preview-worker/health');
  const state = loadState();
  // 先让所有付费资料尽快具备前几页试读能力，再继续生成耗时较长的完整缓存。
  // 避免一个数百页 PDF 阻塞后续所有课程的试读。
  const trialResult = await runPass(state, 'trial', maxTrialJobsPerRun, startCursor);
  const result = trialOnly || trialResult.attempted > 0
    ? trialResult
    : await runPass(state, 'full', maxJobsPerRun);

  console.log(
    JSON.stringify({
      completed: result.failures.length === 0,
      ...result,
    }),
  );
  if (result.failures.length > 0) process.exitCode = 2;
}

run().catch((error) => {
  console.error(`[工作节点终止] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
