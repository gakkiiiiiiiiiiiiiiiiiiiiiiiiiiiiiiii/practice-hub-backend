#!/usr/bin/env node

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
  await record('oss-internal-network', async () => {
    const response = await fetch(
      env.OSS_INTERNAL_HEALTHCHECK_URL ||
        'https://practice-hub-prod-1424780330.oss-cn-shanghai-internal.aliyuncs.com/',
    );
    const responseText = response.status === 403 ? await response.text() : '';
    const errorCode = responseText.match(/<Code>([^<]+)/)?.[1] || '';
    if (errorCode === 'UserDisable') {
      throw new Error('OSS 账号不可用（UserDisable）');
    }
    if (![200, 403, 404].includes(response.status)) {
      throw new Error(`HTTP ${response.status}`);
    }
    return `HTTP ${response.status}${errorCode ? ` (${errorCode})` : ''}`;
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
