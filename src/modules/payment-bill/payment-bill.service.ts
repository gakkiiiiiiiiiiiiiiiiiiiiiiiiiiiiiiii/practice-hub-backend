import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { createHash, randomUUID } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import * as ExcelJS from "exceljs";
import {
  PaymentBill,
  PaymentBillChannel,
  PaymentBillControl,
} from "../../database/entities/payment-bill.entity";
import { Order } from "../../database/entities/order.entity";
import { SysOperationLog } from "../../database/entities/sys-operation-log.entity";
import { BillListDto, BillPageDto, FetchBillDto } from "./payment-bill.dto";
import { PaymentBillGateway } from "./payment-bill.gateway";
import {
  billIdentifiers,
  BILL_NOTICE,
  MAX_BILL_BYTES,
  parseBill,
  ParsedBill,
} from "./payment-bill.parser";

const DAILY_BUDGET = 40;
const BILL_DAILY_BUDGET = 12;
const LEASE_MS = 120000;

export function chinaDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function validateBillDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException("账单日期无效");
  }
}

@Injectable()
export class PaymentBillService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PaymentBill)
    private readonly bills: Repository<PaymentBill>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(SysOperationLog)
    private readonly logs: Repository<SysOperationLog>,
    private readonly gateway: PaymentBillGateway,
  ) {}

  metadata(bill: PaymentBill) {
    return {
      id: bill.id,
      channel: bill.channel,
      billDate: bill.bill_date,
      status: bill.status,
      rowCount: bill.row_count,
      originalSize: bill.original_size,
      fetchedAt: bill.fetched_at,
      retryAfter: bill.retry_after,
      errorMessage: bill.error_message,
      previewSupported: bill.preview_supported,
      notice: bill.notice || BILL_NOTICE,
      sha256: bill.sha256,
      originalFileName: bill.original_filename,
      filename: bill.original_filename,
      contentType: bill.original_filename?.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : bill.original_filename?.endsWith(".csv")
          ? "text/csv; charset=utf-8"
          : "application/octet-stream",
      summary: { rowCount: bill.row_count, notice: bill.notice || BILL_NOTICE },
    };
  }

  async list(query: BillListDto) {
    if (query.startDate) validateBillDate(query.startDate);
    if (query.endDate) validateBillDate(query.endDate);
    if (query.startDate && query.endDate && query.startDate > query.endDate)
      throw new BadRequestException("开始日期不能晚于结束日期");
    const channels: PaymentBillChannel[] = query.channel
      ? [query.channel]
      : ["wechat", "xpay"];
    const keys = channels.flatMap((channel) => {
      try {
        return [this.gateway.accountKey(channel)];
      } catch {
        return [];
      }
    });
    if (!keys.length)
      return { list: [], total: 0, page: query.page, pageSize: query.pageSize };
    const qb = this.bills
      .createQueryBuilder("bill")
      .where("bill.account_key IN (:...keys)", { keys });
    if (query.channel)
      qb.andWhere("bill.channel = :channel", { channel: query.channel });
    if (query.startDate)
      qb.andWhere("bill.bill_date >= :startDate", {
        startDate: query.startDate,
      });
    if (query.endDate)
      qb.andWhere("bill.bill_date <= :endDate", { endDate: query.endDate });
    const [list, total] = await qb
      .orderBy("bill.bill_date", "DESC")
      .addOrderBy("bill.id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      list: list.map((bill) => this.metadata(bill)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async fetch(dto: FetchBillDto) {
    validateBillDate(dto.billDate);
    const today = chinaDay();
    const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * 86400000)
      .toISOString()
      .slice(0, 10);
    if (dto.billDate >= today || dto.billDate < oldest)
      throw new BadRequestException(
        "仅支持过去 89 天已结束日期的日账单，当日账单尚未生成",
      );
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
    if (
      dto.billDate === yesterday &&
      new Date(Date.now() + 8 * 3600000).getUTCHours() < 10
    ) {
      throw new BadRequestException(
        "昨日账单预计北京时间 10:00 后生成，请稍后拉取",
      );
    }
    const accountKey = this.gateway.accountKey(dto.channel);
    const existing = await this.bills.findOne({
      where: {
        account_key: accountKey,
        channel: dto.channel,
        bill_date: dto.billDate,
      },
    });
    if (
      existing &&
      (existing.status === "ready" ||
        (existing.status === "empty" &&
          existing.retry_after &&
          existing.retry_after > new Date()))
    )
      return this.metadata(existing); // zero external calls
    const token = randomUUID();
    const bill = await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(PaymentBillControl)
        .values({ id: 1, attempt_count: 0 })
        .orIgnore()
        .execute();
      const control = await manager.findOneOrFail(PaymentBillControl, {
        where: { id: 1 },
        lock: { mode: "pessimistic_write" },
      });
      const now = new Date();
      if (control.lease_until && control.lease_until > now)
        throw new ConflictException("已有账单正在拉取，请稍后重试");
      let record = await manager.findOne(PaymentBill, {
        where: {
          account_key: accountKey,
          channel: dto.channel,
          bill_date: dto.billDate,
        },
        select: [
          "id",
          "channel",
          "bill_date",
          "status",
          "retry_after",
          "attempt_count",
          "attempt_day",
        ],
        lock: { mode: "pessimistic_write" },
      });
      if (record?.status === "ready")
        throw new ConflictException("账单已缓存，请刷新列表");
      if (record?.retry_after && record.retry_after > now)
        throw new ConflictException(
          "账单仍在退避等待中，请在允许重试时间后操作",
        );
      const globalAttempts =
        control.budget_day === today ? control.attempt_count : 0;
      const attempts = record?.attempt_day === today ? record.attempt_count : 0;
      if (globalAttempts >= DAILY_BUDGET || attempts >= BILL_DAILY_BUDGET)
        throw new ConflictException("已达到今日账单请求上限，请明日重试");
      if (!record)
        record = manager.create(PaymentBill, {
          account_key: accountKey,
          channel: dto.channel,
          bill_date: dto.billDate,
        });
      Object.assign(record, {
        status: "fetching",
        attempt_day: today,
        attempt_count: attempts + 1,
        retry_after: new Date(now.getTime() + LEASE_MS),
        error_message: null,
      });
      await manager.save(PaymentBill, record);
      Object.assign(control, {
        lease_token: token,
        lease_until: new Date(now.getTime() + LEASE_MS),
        budget_day: today,
        attempt_count: globalAttempts + 1,
      });
      await manager.save(PaymentBillControl, control);
      return record;
    });
    try {
      const result = await this.gateway.fetch(dto.channel, dto.billDate);
      if (result.status === "ready") {
        if (!result.original.length || result.original.length > MAX_BILL_BYTES)
          throw new BadRequestException("账单大小超过允许范围");
        const parsed = await parseBill(result.original, dto.channel);
        const extension =
          parsed.format ||
          (result.original[0] === 0x50 && result.original[1] === 0x4b
            ? "zip"
            : "bin");
        await this.finish(token, bill.id, {
          status: "ready",
          original_gzip: gzipSync(result.original),
          original_size: result.original.length,
          sha256: createHash("sha256").update(result.original).digest("hex"),
          preview_supported: parsed.supported,
          row_count: parsed.supported ? parsed.rows.length : null,
          notice: parsed.notice,
          original_filename: `payment-bill-${dto.channel}-${dto.billDate}.${extension}`,
          fetched_at: new Date(),
          retry_after: null,
          error_message: null,
        });
      } else
        await this.finish(token, bill.id, {
          status: result.status,
          retry_after: new Date(
            Date.now() + (result.status === "pending" ? 60000 : 6 * 3600000),
          ),
          fetched_at: result.status === "empty" ? new Date() : null,
          row_count: result.status === "empty" ? 0 : null,
          notice:
            result.status === "empty"
              ? "支付平台明确返回该日无账单。"
              : "平台正在生成账单；一分钟后可手动重试，不会自动轮询。",
        });
    } catch (error) {
      // Never store Axios errors: they contain signed URLs, request credentials or raw provider data.
      const message =
        error instanceof BadRequestException
          ? error.message
          : "账单拉取失败，请检查支付平台权限或网络后重试";
      await this.finish(token, bill.id, {
        status: "failed",
        error_message: message.slice(0, 255),
        retry_after: new Date(
          Date.now() +
            Math.min(3600000, 60000 * 2 ** Math.min(bill.attempt_count - 1, 6)),
        ),
      });
    }
    return this.metadata(await this.bills.findOneByOrFail({ id: bill.id }));
  }

  private async finish(
    token: string,
    id: number,
    update: Partial<PaymentBill>,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const control = await manager.findOneOrFail(PaymentBillControl, {
        where: { id: 1 },
        lock: { mode: "pessimistic_write" },
      });
      if (
        control.lease_token !== token ||
        !control.lease_until ||
        control.lease_until < new Date()
      )
        throw new ConflictException("账单请求租约已过期，请刷新后重试");
      await manager.update(PaymentBill, { id }, update);
      await manager.update(
        PaymentBillControl,
        { id: 1, lease_token: token },
        { lease_token: null, lease_until: null },
      );
    });
  }

  private async stored(id: number) {
    const bill = await this.bills
      .createQueryBuilder("bill")
      .addSelect(["bill.original_gzip", "bill.account_key"])
      .where("bill.id = :id", { id })
      .getOne();
    if (!bill || bill.account_key !== this.gateway.accountKey(bill.channel))
      throw new NotFoundException("账单不存在");
    if (bill.status !== "ready" || !bill.original_gzip)
      throw new BadRequestException("账单尚未就绪");
    let original: Buffer;
    try {
      original = gunzipSync(bill.original_gzip, {
        maxOutputLength: MAX_BILL_BYTES,
      });
    } catch {
      throw new BadRequestException("账单缓存校验失败，请联系管理员");
    }
    if (
      original.length !== bill.original_size ||
      createHash("sha256").update(original).digest("hex") !== bill.sha256
    ) {
      throw new BadRequestException("账单缓存完整性校验失败");
    }
    return { bill, original, parsed: await parseBill(original, bill.channel) };
  }

  async preview(id: number, query: BillPageDto) {
    const { parsed } = await this.stored(id);
    const rows = parsed.rows.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    );
    return {
      columns: parsed.columns,
      rows: await this.matchOrders(parsed, rows),
      total: parsed.rows.length,
      page: query.page,
      pageSize: query.pageSize,
      previewSupported: parsed.supported,
      notice: parsed.notice,
    };
  }

  private async matchOrders(
    parsed: ParsedBill,
    rows: Record<string, string>[],
  ) {
    const identifiers = [
      ...new Set(rows.flatMap((row) => billIdentifiers(parsed, row))),
    ];
    if (!identifiers.length)
      return rows.map((cells) => ({ cells, matchedOrders: [] }));
    const paths = [
      "coin_purchase.recharge_order_no",
      "coin_purchase.currency_pay_order_id",
      "wechat_pay.transaction_id",
      "wechat_pay_callback.transaction_id",
      "wechat_pay_confirm.query_result.transaction_id",
      "wechat_pay_admin_sync.query_result.transaction_id",
    ];
    const candidates = await this.orders
      .createQueryBuilder("o")
      .select(["o.id", "o.order_no", "o.pay_payload"])
      .where(
        `o.order_no IN (:...ids) OR ${paths.map((path) => `JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.${path}')) IN (:...ids)`).join(" OR ")}`,
        { ids: identifiers },
      )
      .take(201)
      .getMany();
    if (candidates.length > 200)
      return rows.map((cells) => ({ cells, matchedOrders: [] }));
    return rows.map((cells) => {
      const ids = billIdentifiers(parsed, cells);
      const matches = candidates.flatMap((order) => {
        const pairs = [
          { value: order.order_no, type: "business_order" },
          ...paths.map((path) => ({
            value: path
              .split(".")
              .reduce((value, key) => value?.[key], order.pay_payload),
            type: path.includes("recharge")
              ? "coin_recharge"
              : path.includes("currency_pay")
                ? "coin_consumption"
                : "wechat_transaction",
          })),
        ];
        const match = pairs.find(
          (pair) => typeof pair.value === "string" && ids.includes(pair.value),
        );
        return match
          ? [{ id: order.id, orderNo: order.order_no, matchType: match.type }]
          : [];
      });
      return { cells, matchedOrders: matches };
    });
  }

  async download(id: number, format: "original" | "xlsx") {
    const { bill, original, parsed } = await this.stored(id);
    const base = `payment-bill-${bill.channel}-${bill.bill_date}`;
    if (format === "original") {
      const extension =
        parsed.format ||
        (original[0] === 0x50 && original[1] === 0x4b
          ? "zip"
          : original[0] === 0x1f && original[1] === 0x8b
            ? "gz"
            : "bin");
      return {
        buffer: original,
        filename: bill.original_filename || `${base}.${extension}`,
        contentType:
          extension === "csv"
            ? "text/csv; charset=utf-8"
            : extension === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/octet-stream",
      };
    }
    if (!parsed.supported)
      throw new BadRequestException("账单格式尚未验证，仅允许下载原始文件");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("交易明细");
    sheet.addRow(parsed.columns.map((column) => column.title));
    for (const row of parsed.rows)
      sheet.addRow(
        parsed.columns.map((column) => String(row[column.key] ?? "")),
      );
    sheet.columns.forEach((column) => {
      column.width = 24;
      column.numFmt = "@";
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    workbook.addWorksheet("口径说明").addRow([parsed.notice]);
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `${base}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  /** Await persistence before exposing sensitive files. Do not record rows, secrets or signed URLs. */
  async audit(
    adminId: number,
    action: "preview" | "download",
    id: number,
    format?: string,
  ) {
    await this.logs.save({
      admin_id: adminId,
      module: "payment-bills",
      action,
      target_id: id,
      content: JSON.stringify({
        billId: id,
        action,
        ...(format ? { format } : {}),
      }),
    });
  }
}
