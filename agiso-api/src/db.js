'use strict';

const mysql = require('mysql2/promise');
const { isRetryableDatabaseError } = require('./errors');

function createPool(config) {
  return mysql.createPool({
    ...config,
    charset: 'utf8mb4',
    waitForConnections: true,
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: false,
    dateStrings: false,
  });
}

async function withTransaction(pool, operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure. The connection is discarded below when needed.
      }
      if (attempt < maxAttempts && isRetryableDatabaseError(error)) continue;
      throw error;
    } finally {
      connection.release();
    }
  }
  throw new Error('unreachable transaction retry state');
}

module.exports = { createPool, withTransaction };
