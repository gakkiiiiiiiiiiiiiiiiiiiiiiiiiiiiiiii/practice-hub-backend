'use strict';

const { loadDatabaseConfig } = require('../src/config');
const { createPool, withTransaction } = require('../src/db');

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error('参数格式错误');
    values.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  const partnerId = Number(values.get('partner-id'));
  const amount = String(values.get('amount') || '');
  const reference = String(values.get('ref') || '');
  if (!Number.isInteger(partnerId) || partnerId <= 0) throw new Error('--partner-id 必须是正整数');
  if (!/^(?:0\.[0-9]{1,2}|[1-9][0-9]{0,7}(?:\.[0-9]{1,2})?)$/.test(amount) || Number(amount) <= 0) {
    throw new Error('--amount 必须是大于 0、最多两位小数且不超过 99999999.99 的金额');
  }
  if (!reference || reference !== reference.trim() || reference.length > 128) {
    throw new Error('--ref 必须是 1-128 个字符且首尾不能有空格的唯一充值凭证');
  }
  return { partnerId, amount, reference };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const pool = createPool(loadDatabaseConfig());
  try {
    const result = await withTransaction(pool, async (connection) => {
      const [partners] = await connection.execute(
        'SELECT id, balance, status FROM agiso_partner WHERE id = ? FOR UPDATE',
        [input.partnerId],
      );
      if (!partners[0]) throw new Error('商户不存在');
      const [existing] = await connection.execute(
        `SELECT id, amount, balance_after, create_time
           FROM agiso_balance_ledger
          WHERE partner_id = ? AND event_type = 'topup' AND biz_ref = ?
          FOR UPDATE`,
        [input.partnerId, input.reference],
      );
      if (existing[0]) {
        if (String(existing[0].amount) !== Number(input.amount).toFixed(2)) {
          throw new Error('该充值凭证已使用且金额不同');
        }
        return { idempotent: true, ledger: existing[0] };
      }
      await connection.execute('UPDATE agiso_partner SET balance = balance + ? WHERE id = ?', [input.amount, input.partnerId]);
      const [balances] = await connection.execute('SELECT balance FROM agiso_partner WHERE id = ?', [input.partnerId]);
      const [insert] = await connection.execute(
        `INSERT INTO agiso_balance_ledger
           (partner_id, order_id, event_type, biz_ref, amount, balance_after, create_time)
         VALUES (?, NULL, 'topup', ?, ?, ?, NOW(6))`,
        [input.partnerId, input.reference, input.amount, balances[0].balance],
      );
      return {
        idempotent: false,
        ledger: { id: insert.insertId, amount: input.amount, balance_after: balances[0].balance },
      };
    });
    process.stdout.write(`${JSON.stringify({ success: true, partner_id: input.partnerId, ref: input.reference, ...result })}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ success: false, message: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArguments };
