'use strict';

const crypto = require('node:crypto');
const { ApiError } = require('./errors');

const HASH_ALGORITHM = 'sha256';
const HASH_ITERATIONS = 210000;
const HASH_BYTES = 32;

function hashClientSecret(secret, salt = crypto.randomBytes(16).toString('base64url')) {
  if (typeof secret !== 'string' || secret.length < 24) {
    throw new Error('client_secret must contain at least 24 characters');
  }
  const digest = crypto.pbkdf2Sync(secret, salt, HASH_ITERATIONS, HASH_BYTES, HASH_ALGORITHM);
  return `pbkdf2_sha256$${HASH_ITERATIONS}$${salt}$${digest.toString('base64url')}`;
}

function verifyClientSecret(secret, encoded) {
  try {
    const [scheme, rawIterations, salt, expectedText] = String(encoded || '').split('$');
    const iterations = Number(rawIterations);
    if (scheme !== 'pbkdf2_sha256' || !Number.isInteger(iterations) || iterations < 100000 || !salt || !expectedText) {
      return false;
    }
    const expected = Buffer.from(expectedText, 'base64url');
    const actual = crypto.pbkdf2Sync(String(secret || ''), salt, iterations, expected.length, HASH_ALGORITHM);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(partner, secret, ttlSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: 'practice-hub-agiso',
    aud: 'agiso-fulfillment',
    sub: String(partner.id),
    cid: partner.client_id,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    jti: crypto.randomBytes(16).toString('base64url'),
  });
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('invalid token shape');
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = crypto.createHmac('sha256', secret).update(unsigned).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('bad signature');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('bad header');
    if (payload.iss !== 'practice-hub-agiso' || payload.aud !== 'agiso-fulfillment') throw new Error('bad claims');
    if (!/^\d+$/.test(String(payload.sub || '')) || !payload.cid) throw new Error('bad subject');
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= nowSeconds) throw new Error('expired');
    if (payload.iat > nowSeconds + 30 || payload.exp - payload.iat > 900) throw new Error('bad lifetime');
    return { partnerId: Number(payload.sub), clientId: String(payload.cid), expiresAt: payload.exp };
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', '访问令牌无效或已过期');
  }
}

function extractBearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  if (!match) throw new ApiError(401, 'AUTH_REQUIRED', '缺少 Bearer 访问令牌');
  return match[1];
}

function generateActivationCode() {
  return `AG${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

module.exports = {
  extractBearerToken,
  generateActivationCode,
  hashClientSecret,
  signToken,
  verifyClientSecret,
  verifyToken,
};
