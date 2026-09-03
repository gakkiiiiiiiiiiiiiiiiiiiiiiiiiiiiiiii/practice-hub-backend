import { TextDecoder } from "util";
import { inflateRawSync } from "zlib";
import * as ExcelJS from "exceljs";
import { SaxesParser } from "saxes";
import { PaymentBillChannel } from "../../database/entities/payment-bill.entity";

export const MAX_BILL_BYTES = 10 * 1024 * 1024;
export const MAX_BILL_CELLS = 100000;
export const BILL_NOTICE =
  "原始账单来自支付平台；关联仅按支付标识匹配，不代表已完成金额对账。虚拟币充值与消费不合并计算收入。";
export type ParsedBill = {
  supported: boolean;
  columns: { key: string; title: string }[];
  rows: Record<string, string>[];
  notice: string;
  format?: "csv" | "xlsx";
};

/** RFC4180-style CSV, preserving long identifiers and exact monetary strings. No floats. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    cellCount = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else cell += char;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(cell.replace(/^`/, ""));
      cell = "";
      if (++cellCount > MAX_BILL_CELLS) throw new Error("CSV cell limit");
      if (char !== ",") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
      }
    } else cell += char;
    if (cell.length > 20000 || row.length > 100 || rows.length > 50000)
      throw new Error("CSV limits exceeded");
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(cell.replace(/^`/, ""));
  if (++cellCount > MAX_BILL_CELLS) throw new Error("CSV cell limit");
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function parseCsvBill(
  buffer: Buffer,
  channel: PaymentBillChannel,
): ParsedBill {
  const unsupported = {
    supported: false,
    columns: [],
    rows: [],
    notice: "已保留原始文件；当前格式尚未验证，暂不提供预览或 Excel 转换。",
  };
  if (!buffer.length || buffer.length > MAX_BILL_BYTES) return unsupported;
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "");
    const csv = readCsv(text);
    // Only known transaction CSV headers qualify. HTML/XML/JSON/error bodies never become empty bills.
    const headerIndex = csv.findIndex(
      (row, index) =>
        index < 5 &&
        (channel === "wechat"
          ? row.includes("商户订单号") &&
            row.includes("微信订单号") &&
            row.includes("交易时间")
          : false), // Enable only after a real Xpay bill schema has been validated.
    );
    if (headerIndex < 0) return unsupported;
    const headers = csv[headerIndex];
    if (
      headers.length > 100 ||
      headers.some((value) => !value || value.length > 200)
    )
      return unsupported;
    const columns = headers.map((title, index) => ({
      key: `c${index}`,
      title,
    }));
    const rows: Record<string, string>[] = [];
    for (const values of csv.slice(headerIndex + 1)) {
      if (/^总交易单数/.test(values[0])) break; // platform totals have a different schema
      if (values.length !== headers.length) return unsupported;
      rows.push(
        Object.fromEntries(values.map((value, index) => [`c${index}`, value])),
      );
    }
    return {
      supported: true,
      columns,
      rows,
      notice: BILL_NOTICE,
      format: "csv",
    };
  } catch {
    return unsupported;
  }
}

export const XPAY_SUMMARY_HEADERS = [
  "出库日期",
  "交易笔数",
  "交易金额",
  "昨日交易笔数",
  "昨日交易金额",
  "退款笔数",
  "技术服务费",
  "平台回退金额",
  "退款金额",
  "结算金额",
  "CPS服务费",
];
export const XPAY_NOTICE =
  "虚拟支付账单为每日结算汇总，记录行数不等于交易笔数；不含逐笔订单标识，无法直接关联业务订单。金额保留平台原值，单位未独立校验，不与虚拟币消费或普通微信支付重复合并。";

function validateWorkbookPart(name: string, bytes: Buffer) {
  if (
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("Noncanonical archive path");
  if (name.endsWith("/")) return;
  if (
    !/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:app|core)\.xml|xl\/(?:workbook|styles|sharedStrings)\.xml|xl\/theme\/theme\d+\.xml|xl\/worksheets\/sheet\d+\.xml|xl\/_rels\/workbook\.xml\.rels)$/.test(
      name,
    )
  ) {
    throw new Error("Unsupported XLSX part");
  }
  const parser = new SaxesParser({ xmlns: false });
  let nodes = 0;
  const sheetIds = new Set<string>();
  parser.on("doctype", () => {
    throw new Error("XLSX DTD not allowed");
  });
  parser.on("opentag", (node) => {
    if (
      ++nodes > 250000 ||
      ["definedNames", "definedName", "externalReferences"].includes(
        node.name.split(":").pop()!,
      )
    ) {
      throw new Error("XLSX node or named-range limit");
    }
    if (name === "xl/workbook.xml" && node.name === "sheet") {
      const id = String(node.attributes.sheetId);
      if (
        !/^[1-9]\d{0,2}$/.test(id) ||
        Number(id) > 200 ||
        sheetIds.has(id) ||
        sheetIds.size >= 1
      )
        throw new Error("Workbook sheet ID or count limit");
      sheetIds.add(id);
    }
  });
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
}

export function validateSheetXml(bytes: Buffer) {
  const parser = new SaxesParser({ xmlns: false });
  let rowCount = 0,
    cellCount = 0;
  const coordinate = (value: string) => {
    const match = /^([A-Z]{1,3})([1-9]\d{0,5})$/.exec(value);
    if (!match) throw new Error("Invalid worksheet coordinate");
    const column = [...match[1]].reduce(
      (result, letter) => result * 26 + letter.charCodeAt(0) - 64,
      0,
    );
    if (column > 100 || Number(match[2]) > 50000)
      throw new Error("Worksheet coordinate exceeds limits");
  };
  parser.on("doctype", () => {
    throw new Error("Worksheet DTD not allowed");
  });
  parser.on("opentag", (node) => {
    const attrs = node.attributes as Record<string, string>;
    if (node.name === "row") {
      if (
        !/^[1-9]\d{0,5}$/.test(attrs.r) ||
        Number(attrs.r) > 50000 ||
        ++rowCount > 50000
      )
        throw new Error("Worksheet row limit");
    }
    if (node.name === "c") {
      coordinate(attrs.r);
      if (++cellCount > MAX_BILL_CELLS) throw new Error("Worksheet cell limit");
    }
    if (node.name === "mergeCell") attrs.ref.split(":").forEach(coordinate);
    if (
      node.name === "col" &&
      (!/^\d+$/.test(attrs.min) ||
        !/^\d+$/.test(attrs.max) ||
        Number(attrs.min) < 1 ||
        Number(attrs.max) > 100)
    )
      throw new Error("Worksheet column range limit");
  });
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
}

/** Verify declared and actual inflation bounds before handing the archive to ExcelJS/JSZip. */
export function validateBillZip(bytes: Buffer): string[] {
  if (bytes.length > MAX_BILL_BYTES) throw new Error("Archive too large");
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new Error("Invalid zip directory");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  if (
    !count ||
    count > 200 ||
    bytes.readUInt16LE(end + 8) !== count ||
    offset + bytes.readUInt32LE(end + 12) !== end
  )
    throw new Error("Unsupported zip layout");
  const names: string[] = [];
  const validateExtras = (extras: Buffer) => {
    for (let index = 0; index < extras.length; ) {
      if (index + 4 > extras.length) throw new Error("Invalid ZIP extra");
      const id = extras.readUInt16LE(index),
        size = extras.readUInt16LE(index + 2);
      if ([0x0001, 0x7075].includes(id) || index + 4 + size > extras.length)
        throw new Error("Unsupported ZIP64 or Unicode path extra");
      index += 4 + size;
    }
  };
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid zip entry");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20),
      expanded = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28),
      extraSize = bytes.readUInt16LE(offset + 30),
      commentSize = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressed > MAX_BILL_BYTES ||
      expanded > MAX_BILL_BYTES ||
      (total += expanded) > MAX_BILL_BYTES ||
      local + 30 > offset ||
      offset + 46 + nameSize + extraSize + commentSize > end
    )
      throw new Error("Zip size or encoding exceeds limits");
    if (
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt16LE(local + 6) !== flags
    )
      throw new Error("Invalid local zip entry");
    const localNameSize = bytes.readUInt16LE(local + 26),
      localExtraSize = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameSize + localExtraSize;
    if (start + compressed > offset)
      throw new Error("Invalid compressed bounds");
    const raw = bytes.subarray(start, start + compressed);
    const inflated =
      method === 0
        ? raw
        : inflateRawSync(raw, { maxOutputLength: Math.max(1, expanded) });
    if (inflated.length !== expanded)
      throw new Error("Zip expanded size mismatch");
    const centralName = bytes.subarray(offset + 46, offset + 46 + nameSize);
    if (
      !centralName.equals(
        bytes.subarray(local + 30, local + 30 + localNameSize),
      )
    )
      throw new Error("ZIP filename mismatch");
    validateExtras(
      bytes.subarray(
        offset + 46 + nameSize,
        offset + 46 + nameSize + extraSize,
      ),
    );
    validateExtras(bytes.subarray(local + 30 + localNameSize, start));
    const name = new TextDecoder("utf-8", { fatal: true }).decode(centralName);
    if (names.includes(name)) throw new Error("Duplicate zip entry");
    validateWorkbookPart(name, inflated);
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) validateSheetXml(inflated);
    names.push(name);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  if (offset !== end) throw new Error("Invalid directory length");
  return names;
}

export async function parseBill(
  buffer: Buffer,
  channel: PaymentBillChannel,
): Promise<ParsedBill> {
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b))
    return parseCsvBill(buffer, channel);
  const unsupported: ParsedBill = {
    supported: false,
    columns: [],
    rows: [],
    notice: "已保留原始文件；当前格式尚未验证，暂不提供预览或 Excel 转换。",
  };
  try {
    const names = validateBillZip(buffer);
    if (!names.includes("xl/workbook.xml")) return unsupported;
    unsupported.format = "xlsx";
    if (channel !== "xpay") return unsupported;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any, {
      ignoreNodes: [
        "mergeCells",
        "cols",
        "hyperlinks",
        "dataValidations",
        "conditionalFormatting",
        "drawing",
        "picture",
        "tableParts",
        "extLst",
        "sheetViews",
        "rowBreaks",
        "colBreaks",
      ],
    });
    if (workbook.worksheets.length !== 1) return unsupported;
    const sheet = workbook.worksheets[0];
    if (sheet.rowCount > 50000 || sheet.columnCount > 100) return unsupported;
    let headerRow = 0;
    for (let index = 1; index <= Math.min(5, sheet.rowCount); index++) {
      const cells = XPAY_SUMMARY_HEADERS.map(
        (_, col) => sheet.getRow(index).getCell(col + 1).text,
      );
      if (
        cells.every((title, col) => title === XPAY_SUMMARY_HEADERS[col]) &&
        sheet.getRow(index).cellCount === XPAY_SUMMARY_HEADERS.length
      )
        headerRow = index;
    }
    if (!headerRow) return unsupported;
    const columns = XPAY_SUMMARY_HEADERS.map((title, index) => ({
      key: `c${index}`,
      title,
    }));
    const rows: Record<string, string>[] = [];
    for (let index = headerRow + 1; index <= sheet.rowCount; index++) {
      const row = sheet.getRow(index);
      if (!row.hasValues) continue;
      if (row.cellCount > columns.length) return unsupported;
      const cells: Record<string, string> = {};
      for (let col = 0; col < columns.length; col++) {
        const cell = row.getCell(col + 1);
        if (
          cell.type === ExcelJS.ValueType.Formula ||
          cell.type === ExcelJS.ValueType.Error ||
          cell.text.length > 20000
        )
          return unsupported;
        cells[`c${col}`] = cell.text;
      }
      rows.push(cells);
    }
    return {
      supported: true,
      columns,
      rows,
      format: "xlsx",
      notice: XPAY_NOTICE,
    };
  } catch {
    return unsupported;
  }
}

export function billIdentifiers(
  parsed: ParsedBill,
  row: Record<string, string>,
): string[] {
  return [
    ...new Set(
      parsed.columns
        .filter((column) => ["商户订单号", "微信订单号"].includes(column.title))
        .map((column) => row[column.key])
        .filter((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value)),
    ),
  ];
}
