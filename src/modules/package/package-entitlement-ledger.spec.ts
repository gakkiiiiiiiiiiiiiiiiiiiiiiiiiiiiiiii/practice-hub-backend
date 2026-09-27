import { calculatePackageExpiry } from './package-entitlement-ledger';

describe('calculatePackageExpiry', () => {
  it('removes one revoked code duration while retaining another purchase', () => {
    const first = { granted_at: '2026-01-01T00:00:00.000Z', duration_days: 30 };
    const second = { granted_at: '2026-01-05T00:00:00.000Z', duration_days: 30 };
    expect(calculatePackageExpiry(null, [first, second])?.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(calculatePackageExpiry(null, [second])?.toISOString()).toBe('2026-02-04T00:00:00.000Z');
  });

  it('keeps pre-existing entitlement and starts later grants after an expired gap', () => {
    const baseline = '2026-01-10T00:00:00.000Z';
    const later = { granted_at: '2026-02-01T00:00:00.000Z', duration_days: 30 };
    expect(calculatePackageExpiry(baseline, [later])?.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    expect(calculatePackageExpiry(baseline, [])?.toISOString()).toBe(baseline);
  });
});
