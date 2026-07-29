#!/usr/bin/env node

const http = require('http');
const { run } = require('./preview-worker');

const port = Math.max(1, Number(process.env.PORT || 8080));
const intervalMs = Math.max(
  60_000,
  Number(process.env.PREVIEW_RUN_INTERVAL_MS || 60_000),
);
let running = false;
let lastStartedAt = null;
let lastFinishedAt = null;
let lastError = null;

async function runOnce() {
  if (running) return;
  running = true;
  lastStartedAt = new Date().toISOString();
  lastError = null;
  try {
    await run();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error(`[工作节点本轮失败] ${lastError}`);
  } finally {
    lastFinishedAt = new Date().toISOString();
    running = false;
  }
}

const server = http.createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/health') {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ready: false, message: 'Not Found' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(
    JSON.stringify({
      ready: true,
      running,
      sourceProvider: process.env.PREVIEW_SOURCE_PROVIDER || 'oss',
      lastStartedAt,
      lastFinishedAt,
      lastError,
    }),
  );
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[工作节点] HTTP 服务已启动: port=${port}`);
  setTimeout(runOnce, 1_000);
  setInterval(runOnce, intervalMs);
});
