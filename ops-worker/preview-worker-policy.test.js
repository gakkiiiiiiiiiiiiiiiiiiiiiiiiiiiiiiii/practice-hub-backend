const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requiresTrialPass,
  shouldRunFullPass,
} = require('./preview-worker-policy');

test('free courses skip the separate trial pass', () => {
  assert.equal(requiresTrialPass({ alwaysFullAccess: true }), false);
  assert.equal(requiresTrialPass({ alwaysFullAccess: 1 }), false);
  assert.equal(requiresTrialPass({ alwaysFullAccess: '1' }), false);
});

test('paid courses still generate trial previews first', () => {
  assert.equal(requiresTrialPass({ alwaysFullAccess: false }), true);
  assert.equal(requiresTrialPass({ alwaysFullAccess: 0 }), true);
});

test('a failed trial-only job does not block the full queue', () => {
  assert.equal(
    shouldRunFullPass(false, {
      attempted: 1,
      processed: 0,
      failures: [{ fileId: 6062 }],
    }),
    true,
  );
});

test('successful pending trial work keeps its priority', () => {
  assert.equal(
    shouldRunFullPass(false, {
      attempted: 2,
      processed: 1,
      failures: [{ fileId: 6062 }],
    }),
    false,
  );
  assert.equal(shouldRunFullPass(true, { attempted: 0, processed: 0, failures: [] }), false);
});
