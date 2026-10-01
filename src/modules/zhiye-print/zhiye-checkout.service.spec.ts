import { ConflictException, NotFoundException } from "@nestjs/common";
import { Order, OrderStatus } from "../../database/entities/order.entity";
import { ZhiyeCheckoutService } from "./zhiye-checkout.service";

describe("ZhiyeCheckoutService", () => {
  const quotedDraft = {
    draftId: 18,
    orderId: null,
    title: "六年级数学练习",
    quoteVersion: "12345678-abcd-4321-abcd-123456789012",
    quoteExpiresAt: new Date(Date.now() + 60_000),
    retailAmountCents: 1235,
    costPrintAmountCents: 700,
    costShippingAmountCents: 250,
    costTotalAmountCents: 950,
    retailMultiplier: 1.3,
    copies: 2,
    shippingAddress: {
      name: "测试用户",
      phone: "13800138000",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      detail: "测试路 1 号",
    },
    sourceFile: {
      file_url: "https://example.test/worksheet.pdf",
      display_name: "六年级数学练习",
      file_name: "worksheet.pdf",
      file_type: "pdf",
      file_page_count: 12,
      quantity: 2,
      sha256: "a".repeat(64),
      file_size: 1024,
    },
    printConfig: { paperSize: 7, duplex: 1 },
  };

  const createHarness = (quote = quotedDraft) => {
    const manager = {
      findOne: jest.fn(),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (_entity, value) => ({
        id: 77,
        create_time: new Date("2026-10-01T00:00:00Z"),
        update_time: new Date("2026-10-01T00:00:00Z"),
        ...value,
      })),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
    };
    const zhiyePrintService = {
      getReadyDraftForOrder: jest.fn().mockResolvedValue(quote),
      attachOrder: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ZhiyeCheckoutService(
      dataSource as any,
      {} as any,
      zhiyePrintService as any,
    );
    return { service, manager, zhiyePrintService };
  };

  it("creates the order only from the locked server quote snapshot", async () => {
    const { service, manager, zhiyePrintService } = createHarness();

    const result = await service.createOrder(9, 18, quotedDraft.quoteVersion);

    expect(zhiyePrintService.getReadyDraftForOrder).toHaveBeenCalledWith(
      9,
      18,
      quotedDraft.quoteVersion,
      manager,
    );
    const persisted = manager.create.mock.calls[0][1];
    expect(persisted).toMatchObject({
      user_id: 9,
      amount: 12.35,
      original_amount: 12.35,
      status: OrderStatus.PENDING,
      pay_provider: "wechat_pay",
      shipping_address: quotedDraft.shippingAddress,
      pay_payload: {
        source_kind: "zhiye",
        fulfillment_type: "paper",
        cloud_print_source_kind: "zhiye",
        cloud_print_source_files: [quotedDraft.sourceFile],
        cloud_print_config_override: quotedDraft.printConfig,
        zhiye_print: {
          draft_id: 18,
          cost_print_amount_cents: 700,
          cost_shipping_amount_cents: 250,
          cost_total_amount_cents: 950,
          retail_multiplier: 1.3,
          retail_amount_cents: 1235,
        },
      },
    });
    expect(zhiyePrintService.attachOrder).toHaveBeenCalledWith(
      9,
      18,
      77,
      manager,
    );
    expect(result).toMatchObject({
      id: 77,
      orderId: 77,
      amount: 12.35,
      amountCents: 1235,
      draftId: 18,
      title: "六年级数学练习",
    });
  });

  it("returns the existing bound order on a repeated request", async () => {
    const existingOrder = {
      id: 77,
      order_no: "ZY-EXISTING",
      user_id: 9,
      amount: 12.35,
      status: OrderStatus.PENDING,
      pay_provider: "wechat_pay",
      shipping_address: quotedDraft.shippingAddress,
      delivery_status: "pending",
      pay_payload: {
        source_kind: "zhiye",
        cloud_print_source_files: [quotedDraft.sourceFile],
        zhiye_print: { draft_id: 18, title: quotedDraft.title },
      },
    } as unknown as Order;
    const { service, manager, zhiyePrintService } = createHarness({
      ...quotedDraft,
      orderId: 77,
    });
    manager.findOne.mockResolvedValue(existingOrder);

    await expect(
      service.createOrder(9, 18, quotedDraft.quoteVersion),
    ).resolves.toMatchObject({
      id: 77,
      orderNo: "ZY-EXISTING",
    });
    expect(manager.save).not.toHaveBeenCalled();
    expect(zhiyePrintService.attachOrder).not.toHaveBeenCalled();
  });

  it("does not return an order bound to another user", async () => {
    const { service, manager } = createHarness({ ...quotedDraft, orderId: 77 });
    manager.findOne.mockResolvedValue({
      id: 77,
      user_id: 10,
      pay_payload: { source_kind: "zhiye" },
    });

    await expect(
      service.createOrder(9, 18, quotedDraft.quoteVersion),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects an invalid persisted retail amount before creating an order", async () => {
    const { service, manager } = createHarness({
      ...quotedDraft,
      retailAmountCents: 0,
    });

    await expect(
      service.createOrder(9, 18, quotedDraft.quoteVersion),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("returns not found instead of leaking another user order", async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const service = new ZhiyeCheckoutService(
      {} as any,
      { createQueryBuilder: jest.fn().mockReturnValue(query) } as any,
      {} as any,
    );

    await expect(service.getOrder(9, 77)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(query.andWhere).toHaveBeenCalledWith("o.user_id = :userId", {
      userId: 9,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("$.source_kind"),
      { sourceKind: "zhiye" },
    );
  });
});
