'use strict';

const { ApiError } = require('./errors');

function createRateLimiter(limit, windowMs = 60000) {
  const buckets = new Map();
  let checks = 0;
  return (key, now = Date.now()) => {
    checks += 1;
    if (checks % 500 === 0) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }
  };
}

module.exports = { createRateLimiter };
