'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recomputePackageExpiry } = require('../src/fulfillment');
const { parseArguments } = require('../scripts/topup');

test('package projection preserves baseline and excludes only revoked events', () => {
  const result = recomputePackageExpiry(new Date('2026-10-01T00:00:00.000Z'), [
    { id: 1, granted_at: new Date('2026-09-27T00:00:00.000Z'), duration_days: 30, revoked_at: null },
    { id: 2, granted_at: new Date('2026-09-28T00:00:00.000Z'), duration_days: 90, revoked_at: new Date() },
    { id: 3, granted_at: new Date('2026-10-31T00:00:00.000Z'), duration_days: 10, revoked_at: null },
  ]);
  assert.equal(result.toISOString(), '2026-11-10T00:00:00.000Z');
});

test('package projection starts at grant time when there is no baseline', () => {
  const result = recomputePackageExpiry(null, [
    { id: 1, granted_at: new Date('2026-09-27T00:00:00.000Z'), duration_days: 30, revoked_at: null },
  ]);
  assert.equal(result.toISOString(), '2026-10-27T00:00:00.000Z');
});

test('topup requires an explicit partner, positive amount and unique reference', () => {
  assert.deepEqual(parseArguments(['--partner-id', '3', '--amount', '100.00', '--ref', 'BANK-20260927-001']), {
    partnerId: 3,
    amount: '100.00',
    reference: 'BANK-20260927-001',
  });
  assert.throws(() => parseArguments(['--partner-id', '3', '--amount', '0', '--ref', 'x']), /amount/);
});
