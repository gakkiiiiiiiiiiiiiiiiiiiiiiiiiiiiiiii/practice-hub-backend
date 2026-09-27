'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { ApiError } = require('./errors');
const { authenticate, issue, revoke } = require('./fulfillment');
const { createRateLimiter } = require('./rate-limit');
const { extractBearerToken, verifyToken } = require('./security');

function writeJson(response, status, payload, requestId) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  });
  response.end(body);
}

function readJson(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    request.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        reject(new ApiError(413, 'BODY_TOO_LARGE', '请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('body must be object');
        resolve(body);
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', '请求体必须是 JSON 对象'));
      }
    });
    request.on('error', reject);
  });
}

function createApplication(config, pool) {
  const authLimit = createRateLimiter(config.authRateLimit);
  const partnerLimit = createRateLimiter(config.partnerRateLimit);

  return async (request, response) => {
    const startedAt = Date.now();
    const requestId = String(request.headers['x-request-id'] || crypto.randomUUID()).slice(0, 100);
    let route = 'unknown';
    let partnerId = null;
    try {
      const url = new URL(request.url, 'http://localhost');
      route = url.pathname;
      if (url.search) throw new ApiError(400, 'QUERY_NOT_ALLOWED', '接口不接受查询参数');
      if (request.method !== 'POST' || !['/auth', '/issue', '/revoke'].includes(route)) {
        throw new ApiError(404, 'NOT_FOUND', '接口不存在');
      }
      if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
      }
      const body = await readJson(request, config.maxBodyBytes);

      let data;
      if (route === '/auth') {
        authLimit(request.socket.remoteAddress || 'unknown');
        data = await authenticate(pool, body, config.tokenSecret, config.tokenTtlSeconds);
      } else {
        const claims = verifyToken(extractBearerToken(request.headers.authorization), config.tokenSecret);
        partnerId = claims.partnerId;
        partnerLimit(String(partnerId));
        data = route === '/issue' ? await issue(pool, partnerId, body) : await revoke(pool, partnerId, body);
      }
      writeJson(response, 200, { success: true, code: 'OK', data, request_id: requestId }, requestId);
      process.stdout.write(`${JSON.stringify({ level: 'info', event: 'request', request_id: requestId, route, partner_id: partnerId, status: 200, duration_ms: Date.now() - startedAt })}\n`);
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const message = known ? error.message : '服务器内部错误';
      if (!response.headersSent) {
        writeJson(response, status, { success: false, code, message, request_id: requestId }, requestId);
      }
      process.stderr.write(`${JSON.stringify({ level: status >= 500 ? 'error' : 'warn', event: 'request_failed', request_id: requestId, route, partner_id: partnerId, status, code, duration_ms: Date.now() - startedAt, database_code: known ? undefined : error?.code })}\n`);
    }
  };
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.database);
  await pool.query('SELECT 1');
  const server = http.createServer(createApplication(config, pool));
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.max(config.requestTimeoutMs + 1000, 5000);
  server.keepAliveTimeout = 5000;
  server.listen(config.port, config.host, () => {
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'server_started', host: config.host, port: config.port })}\n`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'shutdown', signal })}\n`);
    const timer = setTimeout(() => process.exit(1), config.shutdownTimeoutMs).unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'startup_failed', message: error.message, code: error.code })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createApplication, readJson };
