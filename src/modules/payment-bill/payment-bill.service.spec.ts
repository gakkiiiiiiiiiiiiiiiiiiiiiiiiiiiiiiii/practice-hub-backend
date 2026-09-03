import { createHash } from "crypto";
import { gzipSync } from "zlib";
import * as ExcelJS from "exceljs";
import {
  PaymentBill,
  PaymentBillControl,
} from "../../database/entities/payment-bill.entity";
import {
  chinaDay,
  PaymentBillService,
  validateBillDate,
} from "./payment-bill.service";

function harness(initial?: Partial<PaymentBill>, budget = 0) {
  let record = initial
    ? {
        id: 1,
        account_key: "scope",
        channel: "wechat",
        bill_date: "2026-09-01",
        attempt_count: 0,
        ...initial,
      }
    : null;
  const control = {
    id: 1,
    budget_day: "2026-09-03",
    attempt_count: budget,
    lease_token: null,
    lease_until: null,
  };
  const qb: any = {};
  for (const method of ["insert", "into", "values", "orIgnore"])
    qb[method] = jest.fn(() => qb);
  qb.execute = jest.fn().mockResolvedValue({});
  const manager = {
    createQueryBuilder: jest.fn(() => qb),
    findOneOrFail: jest.fn(async () => control),
    findOne: jest.fn(async () => (record ? { ...record } : null)),
    create: jest.fn((_, data) => ({ id: 1, ...data })),
    save: jest.fn(async (entity, value) => {
      if (entity === PaymentBill) record = { ...value };
      else Object.assign(control, value);
      return value;
    }),
    update: jest.fn(async (entity, _, update) => {
      if (entity === PaymentBill) Object.assign(record!, update);
      else Object.assign(control, update);
    }),
  };
  const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
  const bills: any = {
    findOne: jest.fn(async () => record),
    findOneByOrFail: jest.fn(async () => record),
  };
  const orders: any = { createQueryBuilder: jest.fn() };
  const logs: any = { save: jest.fn().mockResolvedValue({}) };
  const gateway: any = {
    accountKey: jest.fn(() => "scope"),
    fetch: jest
      .fn()
      .mockResolvedValue({
        status: "ready",
        original: Buffer.from(
          "交易时间,微信订单号,商户订单号\n`2026-09-01,`WX123,`ORD1",
        ),
      }),
  };
  return {
    service: new PaymentBillService(
      dataSource as any,
      bills,
      orders,
      logs,
      gateway,
    ),
    dataSource,
    bills,
    manager,
    gateway,
    control,
    logs,
    getRecord: () => record,
  };
}

describe("private on-demand payment bills", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-03T04:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());
  it("returns cached bills twice without any external requests or task scan", async () => {
    const { service, gateway, dataSource } = harness({
      status: "ready",
      row_count: 1,
    });
    await service.fetch({ channel: "wechat", billDate: "2026-09-01" });
    await service.fetch({ channel: "wechat", billDate: "2026-09-01" });
    expect(gateway.fetch).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
  it("rejects invalid and unclosed billing days before touching a provider", async () => {
    const { service, gateway } = harness();
    for (const billDate of ["2026-02-31", "2026-09-03", "2025-01-01"])
      await expect(
        service.fetch({ channel: "wechat", billDate }),
      ).rejects.toThrow();
    jest.setSystemTime(new Date("2026-09-03T01:00:00Z"));
    await expect(
      service.fetch({ channel: "wechat", billDate: "2026-09-02" }),
    ).rejects.toThrow("10:00");
    expect(gateway.fetch).not.toHaveBeenCalled();
    expect(chinaDay(new Date("2026-09-02T16:00:00Z"))).toBe("2026-09-03");
    expect(() => validateBillDate("2026-02-31")).toThrow();
  });
  it("atomically leases global work, persists gzip/hash and never returns original bytes in metadata", async () => {
    const h = harness();
    const result = await h.service.fetch({
      channel: "wechat",
      billDate: "2026-09-01",
    });
    expect(result).toMatchObject({
      status: "ready",
      rowCount: 1,
      filename: "payment-bill-wechat-2026-09-01.csv",
    });
    expect(result).not.toHaveProperty("original_gzip");
    expect(result).not.toHaveProperty("account_key");
    expect(h.manager.findOneOrFail).toHaveBeenCalledWith(
      PaymentBillControl,
      expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
    );
    expect(h.control.lease_token).toBeNull();
    expect(h.control.attempt_count).toBe(1);
    expect(h.getRecord()!.original_gzip).toBeInstanceOf(Buffer);
  });
  it("does one generation request and records manual retry time without timers", async () => {
    const h = harness();
    h.gateway.fetch.mockResolvedValue({ status: "pending" });
    expect(
      await h.service.fetch({ channel: "xpay", billDate: "2026-09-01" }),
    ).toMatchObject({
      status: "pending",
      retryAfter: new Date("2026-09-03T04:01:00Z"),
    });
    expect(h.gateway.fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    await expect(
      h.service.fetch({ channel: "xpay", billDate: "2026-09-01" }),
    ).rejects.toThrow("退避");
  });
  it("empty is cached for six hours then can be manually rechecked", async () => {
    const h = harness({
      status: "empty",
      retry_after: new Date("2026-09-03T05:00:00Z"),
    });
    expect(
      (await h.service.fetch({ channel: "wechat", billDate: "2026-09-01" }))
        .status,
    ).toBe("empty");
    expect(h.gateway.fetch).not.toHaveBeenCalled();
    jest.setSystemTime(new Date("2026-09-03T06:00:00Z"));
    expect(
      (await h.service.fetch({ channel: "wechat", billDate: "2026-09-01" }))
        .status,
    ).toBe("ready");
    expect(h.gateway.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["concurrency", "global-budget", "bill-budget"])(
    "blocks external work under %s limit",
    async (kind) => {
      const h = harness(
        {
          status: "failed",
          attempt_day: "2026-09-03",
          attempt_count: kind === "bill-budget" ? 12 : 0,
        },
        kind === "global-budget" ? 40 : 0,
      );
      if (kind === "concurrency")
        h.control.lease_until = new Date("2026-09-03T04:01:00Z") as any;
      await expect(
        h.service.fetch({ channel: "wechat", billDate: "2026-09-01" }),
      ).rejects.toThrow();
      expect(h.gateway.fetch).not.toHaveBeenCalled();
    },
  );
  it("stores sanitized failure and exponential backoff, never transport secrets", async () => {
    const h = harness({
      status: "failed",
      attempt_day: "2026-09-03",
      attempt_count: 2,
    });
    h.gateway.fetch.mockRejectedValue(
      new Error("access_token=private-secret&signed_url=https://private"),
    );
    expect(
      await h.service.fetch({ channel: "wechat", billDate: "2026-09-01" }),
    ).toMatchObject({
      status: "failed",
      retryAfter: new Date("2026-09-03T04:04:00Z"),
    });
    expect(h.getRecord()!.error_message).not.toMatch(/secret|https|token/);
  });
  it("Excel export keeps formula-like text and long order identifiers as strings", async () => {
    jest.useRealTimers();
    const h = harness();
    const original = Buffer.from(
      '交易时间,微信订单号,商户订单号,商品名称\n`2026-09-01,`42000000000000001,`ORD1,=HYPERLINK("evil")',
    );
    const parsed = await import("./payment-bill.parser").then((module) =>
      module.parseBill(original, "wechat"),
    );
    jest
      .spyOn(h.service as any, "stored")
      .mockResolvedValue({
        bill: { channel: "wechat", bill_date: "2026-09-01" },
        original,
        parsed,
      });
    const result = await h.service.download(1, "xlsx");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(result.buffer as any);
    expect(book.worksheets[0].getCell("D2").type).toBe(
      ExcelJS.ValueType.String,
    );
    expect(book.worksheets[0].getCell("B2").text).toBe("42000000000000001");
  });
  it("rejects corrupted private cache and persists minimal download audit before exposure", async () => {
    const h = harness();
    const record = {
      id: 1,
      channel: "wechat",
      account_key: "scope",
      status: "ready",
      original_gzip: gzipSync("a"),
      original_size: 1,
      sha256: createHash("sha256").update("b").digest("hex"),
    };
    const qb: any = {};
    for (const method of ["addSelect", "where"]) qb[method] = jest.fn(() => qb);
    qb.getOne = jest.fn(async () => record);
    h.bills.createQueryBuilder = () => qb;
    await expect(h.service.download(1, "original")).rejects.toThrow("完整性");
    await h.service.audit(7, "download", 1, "original");
    expect(h.logs.save).toHaveBeenCalledWith({
      admin_id: 7,
      module: "payment-bills",
      action: "download",
      target_id: 1,
      content: '{"billId":1,"action":"download","format":"original"}',
    });
  });
});
