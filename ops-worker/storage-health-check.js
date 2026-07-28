#!/usr/bin/env node

const OSS = require('ali-oss');
const { loadEnv, required } = require('./env');

const env = loadEnv();
const checks = [];

async function record(name, operation) {
  const startedAt = Date.now();
  try {
    const detail = await operation();
    checks.push({ name, ok: true, durationMs: Date.now() - startedAt, detail });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function run() {
  const apiBase = required(env, 'WORKER_API_BASE_URL').replace(/\/$/, '');
  const workerToken = required(env, 'PREVIEW_WORKER_TOKEN');
  const oss = new OSS({
    region: env.OSS_REGION || 'oss-cn-shanghai',
    endpoint: env.OSS_INTERNAL_ENDPOINT || 'https://oss-cn-shanghai-internal.aliyuncs.com',
    bucket: required(env, 'OSS_BUCKET'),
    accessKeyId: required(env, 'OSS_ACCESS_KEY_ID'),
    accessKeySecret: required(env, 'OSS_ACCESS_KEY_SECRET'),
    secure: true,
    timeout: 30 * 1000,
  });

  await record('backend', async () => {
    const response = await fetch(`${apiBase}/api/app/recommend/categories`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return `HTTP ${response.status}`;
  });
  await record('preview-worker-api', async () => {
    const response = await fetch(`${apiBase}/api/internal/preview-worker/health`, {
      headers: { 'x-preview-worker-token': workerToken },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return `HTTP ${response.status}`;
  });
  await record('oss-internal', async () => {
    const result = await oss.list({ 'max-keys': 1 }, {});
    return `objects>=${(result.objects || []).length}`;
  });
  if (env.CDN_HEALTHCHECK_URL) {
    await record('cdn', async () => {
      const response = await fetch(env.CDN_HEALTHCHECK_URL, {
        headers: { Range: 'bytes=0-1023' },
      });
      if (![200, 206].includes(response.status)) throw new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
      return `HTTP ${response.status}`;
    });
  }

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), checks }));
  if (!ok) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`[巡检终止] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
