import { BadRequestException } from "@nestjs/common";
import { OrderStatus } from "../../database/entities/order.entity";
import { OrderService } from "./order.service";

describe("OrderService 知页微信支付边界", () => {
  const order = {
    id: 91,
    order_no: "ZY123",
    user_id: 9,
    amount: 12.35,
    status: OrderStatus.PENDING,
    pay_provider: "wechat_pay",
    pay_payload: { source_kind: "zhiye", fulfillment_type: "paper" },
  };

  const createService = () => {
    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = {
      save: jest.fn(async (value) => value),
    };
    service.findOrderByWechatOutTradeNo = jest.fn().mockResolvedValue({
      ...order,
      pay_payload: { ...order.pay_payload },
    });
    service.queryWechatPayOrder = jest.fn();
    service.handlePaymentSuccess = jest
      .fn()
      .mockResolvedValue({ message: "ok" });
    return service;
  };

  it("does not fulfill from an unsigned callback until WeChat confirms the order", async () => {
    const service = createService();
    service.queryWechatPayOrder.mockResolvedValue({
      trade_state: "NOTPAY",
      total_fee: 1235,
    });

    await expect(
      service.handleWechatPayNotify(
        {},
        {
          return_code: "SUCCESS",
          result_code: "SUCCESS",
          out_trade_no: "ZY123",
          total_fee: 1235,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.orderRepository.save).not.toHaveBeenCalled();
    expect(service.handlePaymentSuccess).not.toHaveBeenCalled();
  });

  it("requires the independently queried amount to match exactly", async () => {
    const service = createService();
    service.queryWechatPayOrder.mockResolvedValue({
      trade_state: "SUCCESS",
      total_fee: 1234,
    });

    await expect(
      service.handleWechatPayNotify(
        {},
        {
          return_code: "SUCCESS",
          result_code: "SUCCESS",
          out_trade_no: "ZY123",
          total_fee: 1235,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.handlePaymentSuccess).not.toHaveBeenCalled();
  });

  it("fulfills only after a matching WeChat query result", async () => {
    const service = createService();
    service.queryWechatPayOrder.mockResolvedValue({
      trade_state: "SUCCESS",
      total_fee: 1235,
    });

    await expect(
      service.handleWechatPayNotify(
        {},
        {
          return_code: "SUCCESS",
          result_code: "SUCCESS",
          out_trade_no: "ZY123",
          total_fee: 1235,
        },
      ),
    ).resolves.toEqual({ errcode: 0 });
    expect(service.orderRepository.save).toHaveBeenCalledTimes(1);
    expect(service.handlePaymentSuccess).toHaveBeenCalledWith(91);
  });

  it("keeps practice-hub and zhiye payment identities separated", () => {
    const service = Object.create(OrderService.prototype) as any;
    service.configService = { get: jest.fn(() => "true") };

    expect(() =>
      service.resolveWechatPayOpenId(
        "zhiye:wx1111111111111111:raw-openid",
        { pay_payload: {} },
        "wx0000000000000000",
      ),
    ).toThrow("请在知页打印订单中付款");
    expect(
      service.resolveWechatPayOpenId(
        "zhiye:wx1111111111111111:raw-openid",
        { pay_payload: { source_kind: "zhiye" } },
        "wx1111111111111111",
      ),
    ).toBe("raw-openid");
  });
});
