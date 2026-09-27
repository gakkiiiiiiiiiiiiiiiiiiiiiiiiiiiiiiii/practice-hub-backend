'use strict';

const fs = require('node:fs');

function integer(name, defaultValue, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? defaultValue : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadDatabaseConfig() {
  const sslEnabled = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
  return {
    host: required('DB_HOST'),
    port: integer('DB_PORT', 3306, 1, 65535),
    user: required('DB_USERNAME'),
    password: required('DB_PASSWORD'),
    database: required('DB_DATABASE'),
    connectionLimit: integer('DB_CONNECTION_LIMIT', 6, 1, 20),
    ssl: sslEnabled
      ? { ca: fs.readFileSync(required('DB_SSL_CA_FILE')), rejectUnauthorized: true }
      : undefined,
  };
}

function loadConfig() {
  const tokenSecret = required('AUTH_TOKEN_SECRET');
  if (Buffer.byteLength(tokenSecret) < 32) {
    throw new Error('AUTH_TOKEN_SECRET must contain at least 32 bytes');
  }

  return {
    host: String(process.env.HOST || '127.0.0.1'),
    port: integer('PORT', 3101, 1, 65535),
    maxBodyBytes: integer('MAX_BODY_BYTES', 8192, 1024, 1024 * 1024),
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 10000, 1000, 60000),
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10000, 1000, 60000),
    authRateLimit: integer('AUTH_RATE_LIMIT_PER_MINUTE', 10, 1, 10000),
    partnerRateLimit: integer('PARTNER_RATE_LIMIT_PER_MINUTE', 120, 1, 100000),
    tokenSecret,
    tokenTtlSeconds: integer('AUTH_TOKEN_TTL_SECONDS', 300, 60, 900),
    database: loadDatabaseConfig(),
  };
}

module.exports = { loadConfig, loadDatabaseConfig };
