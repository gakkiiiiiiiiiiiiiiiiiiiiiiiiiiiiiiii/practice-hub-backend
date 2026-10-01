import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomBytes } from "crypto";
import { DataSource, Repository } from "typeorm";
import {
  Order,
  OrderDeliveryStatus,
  OrderShippingAddress,
  OrderStatus,
} from "../../database/entities/order.entity";
import { ZhiyePrintService } from "./zhiye-print.service";

const SOURCE_KIND = "zhiye";
const MAX_RETAIL_AMOUNT_CENTS = 10_000_000;

@Injectable()
export class ZhiyeCheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly zhiyePrintService: ZhiyePrintService,
  ) {}

  async createOrder(userId: number, draftId: number, quoteVersion: string) {
    this.assertUserId(userId);
    const normalizedQuoteVersion = String(quoteVersion || "").trim();
    if (!normalizedQuoteVersion)
      throw new BadRequestException("报价版本不能为空");

    return this.dataSource.transaction(async (manager) => {
      const quoted = (await this.zhiyePrintService.getReadyDraftForOrder(
        userId,
        draftId,
        normalizedQuoteVersion,
        manager,
      )) as Awaited<ReturnType<ZhiyePrintService["getReadyDraftForOrder"]>> & {
        orderId?: number | null;
        sha256?: string;
        fileSize?: number;
      };

      if (quoted.orderId) {
        const existing = await manager.findOne(Order, {
          where: { id: quoted.orderId },
        });
        if (
          !existing ||
          existing.user_id !== userId ||
          existing.pay_payload?.source_kind !== SOURCE_KIND
        ) {
          throw new ConflictException("打印草稿关联订单异常，请联系管理员");
        }
        return this.toOrderView(existing);
      }

      this.assertTrustedQuote(quoted);
      const shippingAddress = this.normalizeTrustedAddress(
        quoted.shippingAddress,
      );
      const retailAmountCents = Number(quoted.retailAmountCents);
      const sourceFile = { ...quoted.sourceFile };
      const order = manager.create(Order, {
        order_no: this.generateOrderNo(),
        user_id: userId,
        course_id: null,
        order_type: "course",
        package_section_id: null,
        package_plan_id: null,
        coupon_id: null,
        amount: retailAmountCents / 100,
        original_amount: retailAmountCents / 100,
        discount_amount: 0,
        status: OrderStatus.PENDING,
        pay_provider: "wechat_pay",
        shipping_address: shippingAddress,
        delivery_status: OrderDeliveryStatus.PENDING,
        pay_payload: {
          source_kind: SOURCE_KIND,
          fulfillment_type: "paper",
          cloud_print_source_kind: SOURCE_KIND,
          cloud_print_source_files: [sourceFile],
          cloud_print_config_override: quoted.printConfig,
          zhiye_print: {
            draft_id: quoted.draftId,
            title: quoted.title,
            quote_version: quoted.quoteVersion,
            cost_print_amount_cents: quoted.costPrintAmountCents,
            cost_shipping_amount_cents: quoted.costShippingAmountCents,
            cost_total_amount_cents: quoted.costTotalAmountCents,
            retail_multiplier: quoted.retailMultiplier,
            retail_amount_cents: retailAmountCents,
          },
        },
      });
      const saved = await manager.save(Order, order);
      await this.zhiyePrintService.attachOrder(
        userId,
        draftId,
        saved.id,
        manager,
      );
      return this.toOrderView(saved);
    });
  }

  async listOrders(userId: number, requestedPage = 1, requestedPageSize = 20) {
    this.assertUserId(userId);
    const page =
      Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Number.isInteger(requestedPageSize)
      ? Math.min(50, Math.max(1, requestedPageSize))
      : 20;
    const query = this.orderRepository
      .createQueryBuilder("o")
      .where("o.user_id = :userId", { userId })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.source_kind')) = :sourceKind",
        {
          sourceKind: SOURCE_KIND,
        },
      )
      .orderBy("o.create_time", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [orders, total] = await query.getManyAndCount();
    return {
      list: orders.map((order) => this.toOrderView(order)),
      total,
      page,
      pageSize,
    };
  }

  async getOrder(userId: number, orderId: number) {
    this.assertUserId(userId);
    if (!Number.isInteger(orderId) || orderId < 1)
      throw new NotFoundException("订单不存在");
    const order = await this.orderRepository
      .createQueryBuilder("o")
      .where("o.id = :orderId", { orderId })
      .andWhere("o.user_id = :userId", { userId })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.source_kind')) = :sourceKind",
        {
          sourceKind: SOURCE_KIND,
        },
      )
      .getOne();
    if (!order) throw new NotFoundException("订单不存在");
    return this.toOrderView(order);
  }

  private assertUserId(userId: number) {
    if (!Number.isInteger(userId) || userId < 1)
      throw new BadRequestException("用户身份无效");
  }

  private assertTrustedQuote(quoted: Record<string, any>) {
    const amount = Number(quoted.retailAmountCents);
    const printCost = Number(quoted.costPrintAmountCents);
    const shippingCost = Number(quoted.costShippingAmountCents);
    const cost = Number(quoted.costTotalAmountCents);
    const multiplier = Number(quoted.retailMultiplier);
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > MAX_RETAIL_AMOUNT_CENTS
    ) {
      throw new ConflictException("报价金额无效，请重新报价");
    }
    if (
      !Number.isInteger(printCost) ||
      printCost < 0 ||
      !Number.isInteger(shippingCost) ||
      shippingCost < 0 ||
      !Number.isInteger(cost) ||
      cost !== printCost + shippingCost ||
      !Number.isFinite(multiplier) ||
      multiplier < 1
    ) {
      throw new ConflictException("报价成本快照无效，请重新报价");
    }
    if (!quoted.sourceFile || quoted.sourceFile.file_type !== "pdf") {
      throw new ConflictException("打印文件快照无效，请重新上传");
    }
    if (!quoted.printConfig || typeof quoted.printConfig !== "object") {
      throw new ConflictException("打印配置快照无效，请重新报价");
    }
  }

  private normalizeTrustedAddress(
    input: Record<string, any> | null,
  ): OrderShippingAddress {
    if (!input || typeof input !== "object")
      throw new ConflictException("收货地址快照缺失");
    const address: OrderShippingAddress = {
      name: String(input.name || "").trim(),
      phone: String(input.phone || "").trim(),
      province: String(input.province || "").trim(),
      city: String(input.city || "").trim(),
      district: String(input.district || "").trim(),
      detail: String(input.detail || "").trim(),
      postalCode: String(input.postalCode || "").trim() || undefined,
      nationalCode: String(input.nationalCode || "").trim() || undefined,
    };
    if (
      !address.name ||
      !address.phone ||
      !address.province ||
      !address.city ||
      !address.district ||
      !address.detail
    ) {
      throw new ConflictException("收货地址快照不完整，请重新报价");
    }
    return address;
  }

  private toOrderView(order: Order) {
    const payload = this.parsePayload(order.pay_payload);
    const zhiye = payload.zhiye_print || {};
    const files = Array.isArray(payload.cloud_print_source_files)
      ? payload.cloud_print_source_files
      : [];
    const sourceFile = files[0] || {};
    const amount = Number(order.amount || 0);
    return {
      id: order.id,
      orderId: order.id,
      orderNo: order.order_no,
      order_no: order.order_no,
      draftId: Number(zhiye.draft_id || 0) || null,
      title: String(zhiye.title || sourceFile.display_name || "知页打印资料"),
      fileName: String(sourceFile.file_name || ""),
      pageCount: Number(sourceFile.file_page_count || 0),
      copies: Number(sourceFile.quantity || 1),
      amount,
      amountCents: Math.round(amount * 100),
      status: order.status,
      payProvider: order.pay_provider,
      shippingAddress: order.shipping_address,
      address: order.shipping_address,
      deliveryStatus: order.delivery_status,
      trackingNo: order.tracking_no || "",
      shipperCode: order.shipper_code || "",
      shipperName: order.shipper_name || "",
      shippedAt: order.shipped_at || null,
      logisticsSnapshot: order.logistics_snapshot || null,
      paidTime: order.paid_time || null,
      createTime: order.create_time,
      updateTime: order.update_time,
    };
  }

  private parsePayload(
    payload: Record<string, any> | string | null | undefined,
  ) {
    if (!payload) return {} as Record<string, any>;
    if (typeof payload === "object") return payload;
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private generateOrderNo() {
    return `ZY${Date.now()}${randomBytes(5).toString("hex")}`;
  }
}
