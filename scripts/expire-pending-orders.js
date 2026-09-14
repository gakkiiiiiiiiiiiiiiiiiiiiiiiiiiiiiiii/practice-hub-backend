#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const ROOT_DIR = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

function readNumberArg(name, fallback, min, max) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
  }
  return parsed;
}

function loadRemoteEnvironment() {
  const envPath = path.join(ROOT_DIR, '.env.remote');
  if (!fs.existsSync(envPath)) throw new Error('未找到 .env.remote');
  return { ...dotenv.parse(fs.readFileSync(envPath)), ...process.env };
}

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${key}`);
  return value;
}

function createBackup(rows, database, cutoffMinutes) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportDir = path.join(ROOT_DIR, 'exports');
  const backupPath = path.join(exportDir, `pending-order-cancellation-${timestamp}.json`);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        database,
        cutoff_minutes: cutoffMinutes,
        orders: rows,
      },
      null,
      2,
    ),
    'utf8',
  );
  return backupPath;
}

async function main() {
  const limit = readNumberArg('limit', 50, 1, 500);
  const cutoffMinutes = readNumberArg('cutoff-minutes', 10, 10, 10080);
  const env = loadRemoteEnvironment();
  const database = required(env, 'REMOTE_DB_DATABASE');
  const connection = await mysql.createConnection({
    host: required(env, 'REMOTE_DB_HOST'),
    port: Number(env.REMOTE_DB_PORT || 3306),
    user: required(env, 'REMOTE_DB_USERNAME'),
    password: required(env, 'REMOTE_DB_PASSWORD'),
    database,
    charset: 'utf8mb4',
  });

  try {
    const [[summary]] = await connection.execute(
      `SELECT COUNT(*) AS due_count, MIN(create_time) AS oldest_create_time
         FROM \`order\`
        WHERE status = 'pending'
          AND create_time <= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [cutoffMinutes],
    );
    const [orders] = await connection.execute(
      `SELECT id, order_no, user_id, status, pay_provider, create_time
         FROM \`order\`
        WHERE status = 'pending'
          AND create_time <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        ORDER BY create_time ASC, id ASC
        LIMIT ?`,
      [cutoffMinutes, limit],
    );

    console.table([
      {
        database,
        due_count: Number(summary.due_count || 0),
        oldest_create_time: summary.oldest_create_time || '-',
        scanned: orders.length,
        limit,
        mode: APPLY ? 'apply' : 'audit',
      },
    ]);
    if (!APPLY || orders.length === 0) {
      console.log(APPLY ? 'scanned=0, cancelled=0' : '当前为只读审计；添加 --apply 后才会取消本批订单。');
      return;
    }

    const backupPath = createBackup(orders, database, cutoffMinutes);
    const ids = orders.map((order) => Number(order.id));
    const placeholders = ids.map(() => '?').join(', ');
    await connection.beginTransaction();
    try {
      const [result] = await connection.execute(
        `UPDATE \`order\`
            SET status = 'cancelled'
          WHERE status = 'pending'
            AND create_time <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
            AND id IN (${placeholders})`,
        [cutoffMinutes, ...ids],
      );
      await connection.commit();
      console.log(`scanned=${orders.length}, cancelled=${Number(result.affectedRows || 0)}`);
      console.log(`备份: ${backupPath}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
