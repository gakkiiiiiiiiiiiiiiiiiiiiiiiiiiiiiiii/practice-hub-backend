/**
 * Offline integration check against an isolated, disposable LOCAL MySQL schema.
 * Usage: node -r ts-node/register/transpile-only scripts/verify-payment-bills-local.cjs [--fixture=/private/file.xlsx]
 * No payment API calls, production database connection, app startup or scheduled jobs.
 */
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { DataSource } = require('typeorm');
const { PaymentBill, PaymentBillControl } = require('../src/database/entities/payment-bill.entity');
const { Order } = require('../src/database/entities/order.entity');
const { SysOperationLog } = require('../src/database/entities/sys-operation-log.entity');
const { PaymentBillService, chinaDay } = require('../src/modules/payment-bill/payment-bill.service');

async function main() {
  const root = path.resolve(__dirname, '..');
  const env = {};
  for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) Object.assign(env, require('dotenv').parse(fs.readFileSync(file)));
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error('Local MySQL only');
  const fixtureArg = process.argv.find(arg => arg.startsWith('--fixture='));
  const fixture = fixtureArg ? fs.readFileSync(path.resolve(fixtureArg.slice(10))) : null;
  const database = `bill_verify_${crypto.randomBytes(6).toString('hex')}`;
  const config = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USERNAME, password: env.DB_PASSWORD, connectTimeout: 5000 };
  const connection = await mysql.createConnection(config);
  let ds;
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${database}\``);
    created = true;
    await connection.changeUser({ database });
    const migration = fs.readFileSync(path.join(root, 'migrations/create_payment_bill_tables.sql'), 'utf8');
    const statements = migration.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim());
    for (let pass = 0; pass < 2; pass++) for (const sql of statements) await connection.query(sql);
    await connection.query('CREATE TABLE `order` (id INT PRIMARY KEY, order_no VARCHAR(64), pay_payload JSON)');
    await connection.query('CREATE TABLE sys_operation_log (id INT AUTO_INCREMENT PRIMARY KEY, admin_id INT, module VARCHAR(50), action VARCHAR(50), target_id INT, content TEXT, ip VARCHAR(50), create_time DATETIME DEFAULT CURRENT_TIMESTAMP)');
    ds = new DataSource({ type: 'mysql', ...config, username: config.user, database, timezone: '+08:00', entities: [path.join(root, 'src/database/entities/*.entity.ts')], synchronize: false, logging: false });
    await ds.initialize();
    const bills = ds.getRepository(PaymentBill);
    const controls = ds.getRepository(PaymentBillControl);
    const csv = Buffer.from('交易时间,微信订单号,商户订单号,交易状态,总金额\n`2026-08-31 10:00:00,`wx_fixture,`bill_test_order,`SUCCESS,`1.00\n');
    await connection.execute('INSERT INTO `order` (id, order_no, pay_payload) VALUES (1, ?, ?)', ['bill_test_order', JSON.stringify({})]);
    let attempted = 0;
    let mode = 'ready';
    const accountKey = channel => crypto.createHash('sha256').update(`local-verification:${channel}`).digest('hex');
    let release;
    let entered;
    const gateway = {
      accountKey,
      fetch: async channel => {
        attempted++;
        if (mode === 'hold') {
          entered();
          await new Promise(resolve => { release = resolve; });
        }
        if (mode === 'pending' || mode === 'empty') return { status: mode };
        if (mode === 'failed') throw new Error('sensitive-provider-secret-must-not-persist');
        return { status: 'ready', original: channel === 'xpay' && fixture ? fixture : csv };
      },
    };
    const service = new PaymentBillService(ds, bills, ds.getRepository(Order), ds.getRepository(SysOperationLog), gateway);
    const day = offset => new Date(Date.parse(`${chinaDay()}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
    const dto = { channel: 'wechat', billDate: day(2) };
    const ready = await service.fetch(dto);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.previewSupported, true);
    const before = attempted;
    for (let round = 1; round <= 2; round++) {
      assert.equal((await service.fetch(dto)).id, ready.id);
      const list = await service.list({ page: 1, pageSize: 20 });
      assert.equal(list.total, 1);
      assert.ok(!JSON.stringify(list).includes('original_gzip'));
      const preview = await service.preview(ready.id, { page: 1, pageSize: 20 });
      assert.equal(preview.total, 1);
      assert.equal(preview.rows[0].matchedOrders[0].orderNo, 'bill_test_order');
      assert.deepEqual((await service.download(ready.id, 'original')).buffer, csv);
      assert.ok((await service.download(ready.id, 'xlsx')).buffer.length > 100);
      assert.equal(attempted, before);
      console.log(`cache round=${round} attempted=0`);
    }
    await service.audit(1, 'download', ready.id, 'original');
    assert.equal(await ds.getRepository(SysOperationLog).count(), 1);
    const secondService = new PaymentBillService(ds, bills, ds.getRepository(Order), ds.getRepository(SysOperationLog), gateway);
    mode = 'hold';
    const started = new Promise(resolve => { entered = resolve; });
    const first = service.fetch({ ...dto, billDate: day(3) });
    await started;
    await assert.rejects(secondService.fetch({ ...dto, billDate: day(4) }), /正在拉取/);
    release();
    await first;
    mode = 'pending';
    const pending = await service.fetch({ ...dto, billDate: day(4) });
    assert.equal(pending.status, 'pending');
    await assert.rejects(service.fetch({ ...dto, billDate: day(4) }), /退避/);
    mode = 'empty';
    const empty = await service.fetch({ ...dto, billDate: day(5) });
    assert.equal(empty.status, 'empty');
    const emptyBefore = attempted;
    await service.fetch({ ...dto, billDate: day(5) });
    assert.equal(attempted, emptyBefore);
    await bills.update(empty.id, { retry_after: new Date(0) });
    mode = 'ready';
    assert.equal((await service.fetch({ ...dto, billDate: day(5) })).status, 'ready');
    mode = 'failed';
    const failed = await service.fetch({ ...dto, billDate: day(6) });
    assert.equal(failed.status, 'failed');
    assert.ok(!JSON.stringify(failed).includes('sensitive-provider-secret'));
    if (fixture) {
      mode = 'ready';
      const virtual = await service.fetch({ channel: 'xpay', billDate: day(2) });
      assert.equal(virtual.previewSupported, true);
      assert.match(virtual.filename, /\.xlsx$/);
      assert.deepEqual((await service.download(virtual.id, 'original')).buffer, fixture);
      const preview = await service.preview(virtual.id, { page: 1, pageSize: 20 });
      assert.equal(preview.columns.length, 11);
      assert.ok(preview.rows.every(row => row.matchedOrders.length === 0));
      console.log(`real Xpay fixture: previewColumns=${preview.columns.length}; original hash preserved; no transaction matching`);
    }
    await controls.update(1, { budget_day: chinaDay(), attempt_count: 40 });
    await assert.rejects(service.fetch({ ...dto, billDate: day(7) }), /请求上限/);
    const otherGateway = { ...gateway, accountKey: () => 'different-account' };
    const other = new PaymentBillService(ds, bills, ds.getRepository(Order), ds.getRepository(SysOperationLog), otherGateway);
    await assert.rejects(other.preview(ready.id, { page: 1, pageSize: 20 }), /不存在/);
    assert.equal((await other.list({ page: 1, pageSize: 20 })).total, 0);
    console.log('PASS: migration twice, private cache, matching, downloads, audit, cross-instance lease, backoff, empty retry, daily budget, account isolation. External requests=0.');
  } finally {
    if (ds?.isInitialized) await ds.destroy();
    if (created && /^bill_verify_[a-f0-9]{12}$/.test(database)) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
}
main().catch(error => {
  console.error({ message: error instanceof assert.AssertionError ? error.message : 'Local payment-bill verification failed', code: error.code || error.name });
  process.exitCode = 1;
});
