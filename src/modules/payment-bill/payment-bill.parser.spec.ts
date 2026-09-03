import * as ExcelJS from "exceljs";
import {
  MAX_BILL_BYTES,
  parseBill,
  readCsv,
  validateBillZip,
  validateSheetXml,
  XPAY_SUMMARY_HEADERS,
} from "./payment-bill.parser";

async function xlsx(rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("数据");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("payment bill parsing", () => {
  it("preserves CSV identifiers, decimals, quoted commas and line breaks; drops platform total rows", async () => {
    const bill = await parseBill(
      Buffer.from(
        '\uFEFF交易时间,微信订单号,商户订单号,总金额,商品名称\r\n`2026-09-01,`420000000000000001,`ORD_1,`0.10,"含,逗号\n名称"\r\n总交易单数,总交易额\r\n1,0.10\r\n',
      ),
      "wechat",
    );
    expect(bill.supported).toBe(true);
    expect(bill.rows).toEqual([
      {
        c0: "2026-09-01",
        c1: "420000000000000001",
        c2: "ORD_1",
        c3: "0.10",
        c4: "含,逗号\n名称",
      },
    ]);
  });
  it.each([
    "<html>error</html>",
    '{"errcode":1}',
    "foo,bar\n1,2",
    "交易时间,微信订单号,商户订单号\nonly,two",
  ])("never treats unknown data as an empty valid bill: %s", async (value) => {
    expect((await parseBill(Buffer.from(value), "wechat")).supported).toBe(
      false,
    );
  });
  it("rejects malformed quotes and oversized cells", () => {
    expect(() => readCsv('a,"unfinished')).toThrow();
    expect(() => readCsv("a".repeat(20001))).toThrow();
  });
  it("parses only the validated Xpay settlement-summary schema and keeps financial meanings separate", async () => {
    const bytes = await xlsx([
      ["\uFEFF图表数据"],
      XPAY_SUMMARY_HEADERS,
      [20260831, 1, 0.1, 0, 0, 0, 0.01, 0, 0, 0.09, 0],
    ]);
    const bill = await parseBill(bytes, "xpay");
    expect(bill).toMatchObject({ supported: true, format: "xlsx" });
    expect(bill.rows).toHaveLength(1);
    expect(bill.rows[0].c2).toBe("0.1");
    expect(bill.notice).toContain("单位未独立校验");
    expect(bill.notice).toContain("无法直接关联业务订单");
  });
  it("keeps an unrecognized XLSX available as original only and rejects formula cells", async () => {
    expect(
      await parseBill(
        await xlsx([
          ["Unverified", "Amount"],
          ["a", 1],
        ]),
        "xpay",
      ),
    ).toMatchObject({ supported: false, format: "xlsx" });
    const bytes = await xlsx([
      XPAY_SUMMARY_HEADERS,
      [20260831, { formula: "1+1", result: 2 }],
    ]);
    expect((await parseBill(bytes, "xpay")).supported).toBe(false);
  });
  it("rejects forged ZIP size declarations before ExcelJS decompression", async () => {
    const bytes = await xlsx([XPAY_SUMMARY_HEADERS, [20260831, 1]]);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const oversized = Buffer.from(bytes);
    oversized.writeUInt32LE(MAX_BILL_BYTES + 1, central + 24);
    expect(() => validateBillZip(oversized)).toThrow();
    const undersized = Buffer.from(bytes);
    undersized.writeUInt32LE(1, central + 24);
    expect(() => validateBillZip(undersized)).toThrow();
  });
  it("rejects unclosed ZIP, duplicate entries and too many entries", async () => {
    const bytes = await xlsx([XPAY_SUMMARY_HEADERS]);
    expect(() =>
      validateBillZip(bytes.subarray(0, bytes.length - 1)),
    ).toThrow();
    const excessive = Buffer.from(bytes);
    excessive.writeUInt16LE(201, excessive.length - 12);
    expect(() => validateBillZip(excessive)).toThrow();
  });
  it("rejects huge merged, sparse and column ranges before ExcelJS model allocation", () => {
    for (const node of [
      '<mergeCell ref="A2:XFD1048576"/>',
      '<col min="1" max="1048576"/>',
      '<row r="1048576"/>',
      '<row r="&#49;048576"/>',
      '<c r="XFD1"/>',
    ]) {
      expect(() =>
        validateSheetXml(Buffer.from(`<worksheet>${node}</worksheet>`)),
      ).toThrow();
    }
  });
  it("rejects workbook defined names before range expansion", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("数据").addRow(XPAY_SUMMARY_HEADERS);
    book.definedNames.add("数据!A1", "UnsafeNamedRange");
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    expect(() => validateBillZip(bytes)).toThrow("named-range");
  });
});
