'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateActivationCode,
  hashClientSecret,
  signToken,
  verifyClientSecret,
  verifyToken,
} = require('../src/security');

test('client secret hash verifies the right secret only', () => {
  const encoded = hashClientSecret('correct-secret-with-enough-entropy');
  assert.equal(verifyClientSecret('correct-secret-with-enough-entropy', encoded), true);
  assert.equal(verifyClientSecret('wrong-secret-with-enough-entropy-x', encoded), false);
});

test('short-lived bearer token verifies claims and rejects expiry', () => {
  const secret = 'server-token-secret-that-is-at-least-32-bytes';
  const token = signToken({ id: 7, client_id: 'agiso-pdd' }, secret, 300, 1000);
  assert.deepEqual(verifyToken(token, secret, 1100), {
    partnerId: 7,
    clientId: 'agiso-pdd',
    expiresAt: 1300,
  });
  assert.throws(() => verifyToken(token, secret, 1300), /访问令牌无效或已过期/);
});

test('activation codes use a fixed CSPRNG-backed format', () => {
  const values = new Set(Array.from({ length: 100 }, generateActivationCode));
  assert.equal(values.size, 100);
  for (const value of values) assert.match(value, /^AG[0-9A-F]{32}$/);
});
