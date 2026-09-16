import { BadRequestException, ForbiddenException } from '@nestjs/common';
import axios from 'axios';
import { OrderService } from './order.service';
import { OrderStatus } from '../../database/entities/order.entity';

describe('OrderService pending order cancellation', () => {
  const createService = (order: Record<string, unknown>, affected = 1) => {
    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({ affected }),
    };
    return service;
  };

  it('cancels only the authenticated user pending order with a conditional update', async () => {
    const order = { id: 10, user_id: 7, order_no: 'ORDER10', status: OrderStatus.PENDING };
    const service = createService(order);

    await expect(service.cancelPendingOrder(7, 10)).resolves.toEqual({
      message: '订单已取消',
      order_no: 'ORDER10',
      status: OrderStatus.CANCELLED,
    });
    expect(service.orderRepository.update).toHaveBeenCalledWith(
      { id: 10, user_id: 7, status: OrderStatus.PENDING },
      { status: OrderStatus.CANCELLED },
    );
  });

  it('does not cancel another user order', async () => {
    const service = createService({ id: 10, user_id: 8, order_no: 'ORDER10', status: OrderStatus.PENDING });

    await expect(service.cancelPendingOrder(7, 10)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.orderRepository.update).not.toHaveBeenCalled();
  });

  it('treats repeated cancellation as idempotent', async () => {
    const service = createService({ id: 10, user_id: 7, order_no: 'ORDER10', status: OrderStatus.CANCELLED });

    await expect(service.cancelPendingOrder(7, 10)).resolves.toEqual({
      message: '订单已取消',
      order_no: 'ORDER10',
      status: OrderStatus.CANCELLED,
    });
    expect(service.orderRepository.update).not.toHaveBeenCalled();
  });

  it('rejects cancellation after payment', async () => {
    const service = createService({ id: 10, user_id: 7, order_no: 'ORDER10', status: OrderStatus.PAID });

    await expect(service.cancelPendingOrder(7, 10)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.orderRepository.update).not.toHaveBeenCalled();
  });
});

describe('OrderService paper material checkout', () => {
  it('recalculates the paper price on the server and stores the pricing snapshot', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.courseRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 9,
        name: '诊断学资料',
        content_type: 'file',
        price: 5,
        is_free: 0,
      }),
    };
    service.courseFileRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 91, course_id: 9, status: 1, sort: 0, file_type: 'pdf', file_page_count: 22 },
      ]),
    };
    service.referralCouponService = {};
    service.appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 7, openid: 'openid' }),
    };
    service.orderRepository = {
      create: jest.fn((value) => ({ id: 100, ...value })),
      save: jest.fn(async (value) => value),
    };
    service.generateOrderNo = jest.fn(() => 'PAPER100');
    service.processWechatPayPayment = jest.fn(async ({ order }) => order);

    const result = await service.createCourseOrder(7, {
      course_id: 9,
      fulfillment_type: 'paper',
      expected_amount: 12,
      shipping_address: {
        name: '测试用户',
        phone: '13800138000',
        province: '上海市',
        city: '上海市',
        district: '浦东新区',
        detail: '测试路 1 号',
      },
    });

    expect(result.amount).toBe(12);
    expect(result.pay_provider).toBe('wechat_pay');
    expect(result.pay_payload).toMatchObject({
      fulfillment_type: 'paper',
      paper_material: {
        total_pages: 22,
        price: 12,
        unit_price: 12,
        quantity: 1,
        material_total_price: 12,
        regional_shipping_fee: 0,
        regional_shipping_region: null,
        total_price: 12,
      },
    });
  });

  it('adds one regional shipping fee to a single paper material order', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.courseRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 9,
        name: '诊断学资料',
        content_type: 'file',
        price: 5,
        is_free: 0,
      }),
    };
    service.courseFileRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 91, course_id: 9, status: 1, sort: 0, file_type: 'pdf', file_page_count: 22 },
      ]),
    };
    service.referralCouponService = {};
    service.appUserRepository = { findOne: jest.fn().mockResolvedValue({ id: 7, openid: 'openid' }) };
    service.orderRepository = {
      create: jest.fn((value) => ({ id: 100, ...value })),
      save: jest.fn(async (value) => value),
    };
    service.generateOrderNo = jest.fn(() => 'PAPER-REGIONAL');
    service.processWechatPayPayment = jest.fn(async ({ order }) => order);

    const result = await service.createCourseOrder(7, {
      course_id: 9,
      fulfillment_type: 'paper',
      quantity: 3,
      expected_amount: 44,
      shipping_address: {
        name: '测试用户',
        phone: '13800138000',
        province: '宁夏回族自治区',
        city: '银川市',
        district: '兴庆区',
        detail: '测试路 1 号',
      },
    });

    expect(result.amount).toBe(44);
    expect(result.original_amount).toBe(44);
    expect(result.pay_payload.paper_material).toMatchObject({
      unit_price: 12,
      quantity: 3,
      material_total_price: 36,
      regional_shipping_fee: 8,
      regional_shipping_region: '宁夏',
      total_price: 44,
    });
  });

  it('multiplies the server-calculated paper price by the requested quantity', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.courseRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 9,
        name: '诊断学资料',
        content_type: 'file',
        price: 5,
        is_free: 0,
      }),
    };
    service.courseFileRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 91, course_id: 9, status: 1, sort: 0, file_type: 'pdf', file_page_count: 22 },
      ]),
    };
    service.referralCouponService = {};
    service.appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 7, openid: 'openid' }),
    };
    service.orderRepository = {
      create: jest.fn((value) => ({ id: 100, ...value })),
      save: jest.fn(async (value) => value),
    };
    service.generateOrderNo = jest.fn(() => 'PAPER300');
    service.processWechatPayPayment = jest.fn(async ({ order }) => order);

    const result = await service.createCourseOrder(7, {
      course_id: 9,
      fulfillment_type: 'paper',
      quantity: 3,
      expected_amount: 36,
      shipping_address: {
        name: '测试用户',
        phone: '13800138000',
        province: '上海市',
        city: '上海市',
        district: '浦东新区',
        detail: '测试路 1 号',
      },
    });

    expect(result.amount).toBe(36);
    expect(result.original_amount).toBe(36);
    expect(result.pay_payload.paper_material).toMatchObject({
      price: 12,
      unit_price: 12,
      quantity: 3,
      total_price: 36,
    });
    expect(service.processWechatPayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        goodsTitle: '诊断学资料（纸质版×3）',
        responseExtras: expect.objectContaining({ quantity: 3 }),
      }),
    );
  });

  it('rejects an invalid paper material quantity', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.courseRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 9, name: '诊断学资料', content_type: 'file', price: 5 }),
    };

    await expect(
      service.createCourseOrder(7, {
        course_id: 9,
        fulfillment_type: 'paper',
        quantity: 0,
      }),
    ).rejects.toThrow('纸质资料购买数量必须为1-99份');
  });

  it('rejects coupons for paper material orders before coupon validation', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.courseRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 9, name: '诊断学资料', content_type: 'file', price: 5 }),
    };
    service.referralCouponService = { validateCouponForOrder: jest.fn() };

    await expect(
      service.createCourseOrder(7, {
        course_id: 9,
        fulfillment_type: 'paper',
        coupon_id: 3,
      }),
    ).rejects.toThrow('纸质资料不能使用优惠券，优惠券仅限电子资料使用');
    expect(service.referralCouponService.validateCouponForOrder).not.toHaveBeenCalled();
  });

  it('rejects coupons when a cart contains a physical paper course', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.courseRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 11, name: '纸质真题', content_type: 'paper_exam', price: 20, is_free: 0 },
      ]),
    };
    service.referralCouponService = { validateCouponForOrder: jest.fn() };

    await expect(
      service.createCartOrder(7, {
        course_ids: [11],
        coupon_id: 3,
        shipping_address: {
          name: '测试用户',
          phone: '13800138000',
          province: '上海市',
          city: '上海市',
          district: '浦东新区',
          detail: '测试路 1 号',
        },
      }),
    ).rejects.toThrow('纸质资料不能使用优惠券，优惠券仅限电子资料使用');
    expect(service.referralCouponService.validateCouponForOrder).not.toHaveBeenCalled();
  });

  it('does not grant or revoke digital access for a paper-only order', async () => {
    const order: any = {
      id: 101,
      user_id: 7,
      course_id: 9,
      order_type: 'course',
      status: OrderStatus.PENDING,
      coupon_id: null,
      pay_payload: { fulfillment_type: 'paper' },
    };
    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (value) => value),
    };
    service.distributorService = {
      processOrderCommission: jest.fn().mockResolvedValue(undefined),
    };
    service.cloudPrintService = { enqueuePaidOrder: jest.fn().mockResolvedValue(null) };
    service.logger = { error: jest.fn() };
    service.grantCourseAccess = jest.fn();
    service.revokeCourseAccess = jest.fn();

    await service.handlePaymentSuccess(order.id);
    await service.revokeOrderAccess(order);

    expect(service.grantCourseAccess).not.toHaveBeenCalled();
    expect(service.revokeCourseAccess).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.PAID);
  });
});

describe('OrderService paper shipping list', () => {
  it('includes paid paper material orders in the app admin shipping query', async () => {
    const paperMaterialRow = {
      id: 101,
      orderNo: 'PAPER101',
      userId: 7,
      amount: 20,
      status: OrderStatus.PAID,
      orderType: 'course',
      courseId: 9,
      courseName: '诊断学资料',
      contentType: 'file',
      payPayload: JSON.stringify({
        fulfillment_type: 'paper',
        paper_material: { quantity: 3 },
      }),
      shippingAddress: JSON.stringify({ name: '测试用户', phone: '13800138000' }),
      deliveryStatus: 'pending',
    };
    const query: any = {
      leftJoin: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      select: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([paperMaterialRow]),
    };
    Object.keys(query).forEach((key) => {
      if (key !== 'getRawMany') query[key].mockReturnValue(query);
    });

    const service = Object.create(OrderService.prototype) as any;
    service.appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 1, role: 'admin' }),
    };
    service.orderRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    service.getLatestAfterSaleMap = jest.fn().mockResolvedValue(new Map());

    const result = await service.getAppAdminShippingOrderList(1, 'pending');

    expect(query.andWhere).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.fulfillment_type'))"),
      { paperType: 'paper_exam', paperFulfillmentType: 'paper' },
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 101,
        productName: '诊断学资料（纸质资料 × 3）',
        contentType: 'file',
        requiresShipping: true,
      }),
    ]);
  });
});

describe('OrderService category bundle access', () => {
  it('grants a permanent category entitlement instead of snapshot course permissions', async () => {
    const order: any = {
      id: 88,
      order_no: 'CATEGORY88',
      user_id: 7,
      order_type: 'category',
      status: OrderStatus.PENDING,
      coupon_id: null,
      pay_payload: { category_bundle: { category_id: 12, course_ids: [101, 102] } },
    };
    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (value) => value),
      manager: {
        query: jest.fn().mockResolvedValue({ affectedRows: 2 }),
      },
    };
    service.categoryBundleAccessService = {
      grantOrderAccess: jest.fn().mockResolvedValue(undefined),
    };
    service.distributorService = {
      processOrderCommission: jest.fn().mockResolvedValue(undefined),
    };
    service.grantCourseAccess = jest.fn();

    await service.handlePaymentSuccess(order.id);

    expect(service.categoryBundleAccessService.grantOrderAccess).toHaveBeenCalledWith(order);
    expect(service.grantCourseAccess).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.PAID);
  });

  it('revokes the entitlement for a refunded category order', async () => {
    const service = Object.create(OrderService.prototype) as any;
    service.categoryBundleAccessService = {
      revokeOrderAccess: jest.fn().mockResolvedValue(undefined),
    };

    await service.revokeOrderAccess({ id: 88, order_type: 'category' } as any);

    expect(service.categoryBundleAccessService.revokeOrderAccess).toHaveBeenCalledWith(88);
  });
});

describe('OrderService WeChat Pay refund', () => {
  const createService = () => {
    const service = Object.create(OrderService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          WECHAT_APPID: 'wx-test',
          WECHAT_PAY_MCH_ID: 'default-sub-mch',
          WECHAT_PAY_CLOUDRUN_ENV_ID: 'prod-env',
          WECHAT_PAY_CALLBACK_SERVICE: 'prod',
          WECHAT_PAY_CALLBACK_PATH: '/api/app/order/pay/notify',
        };
        return values[key];
      }),
    };
    service.generateNonceStr = jest.fn(() => 'nonce');
    service.callWechatPayOpenApi = jest.fn().mockResolvedValue({ return_code: 'SUCCESS' });
    service.orderRepository = {
      save: jest.fn(async (order) => order),
    };
    service.cloudPrintService = { reserveRefund: jest.fn().mockResolvedValue(null) };
    return service;
  };

  it('uses callback sub merchant and transaction id when refunding legacy paper orders', async () => {
    const service = createService();
    const order: any = {
      order_no: 'ORDER17832972611920965',
      amount: 75,
      pay_payload: {
        wechat_pay: {
          out_trade_no: 'ORDER17832972611920965',
          total_fee: 7500,
        },
        wechat_pay_callback: {
          subMchId: 'callback-sub-mch',
          transactionId: 'wx-transaction-id',
        },
      },
    };

    await service.refundWechatPayOrder(order, 'ORDER17832972611920965_WX_RF', '售后退款');

    expect(service.callWechatPayOpenApi).toHaveBeenCalledWith(
      'refund',
      expect.objectContaining({
        sub_mch_id: 'callback-sub-mch',
        transaction_id: 'wx-transaction-id',
        out_refund_no: 'ORDER17832972611920965_WX_RF',
        total_fee: 7500,
        refund_fee: 7500,
      }),
    );
    expect(service.callWechatPayOpenApi.mock.calls[0][1]).not.toHaveProperty('out_trade_no');
  });

  it('stores the sub merchant used to create a new WeChat Pay order', async () => {
    const service = createService();
    service.getCloudPayConfig = jest.fn(() => ({
      subAppid: 'wx-test',
      subMchId: 'new-sub-mch',
      callbackEnvId: 'prod-env',
      callbackService: 'prod',
      callbackPath: '/api/app/order/pay/notify',
      spbillCreateIp: '127.0.0.1',
    }));
    service.createWechatPayPaymentParams = jest.fn().mockResolvedValue({
      timeStamp: '1',
      nonceStr: 'nonce',
      package: 'prepay_id=test',
      signType: 'MD5',
      paySign: 'sign',
    });

    const order: any = {
      order_no: 'ORDER1',
      amount: 80,
      order_type: 'course',
      course_id: 1,
      status: OrderStatus.PENDING,
      pay_payload: null,
    };

    await service.processWechatPayPayment({
      user: { id: 1, openid: 'openid' },
      order,
      goodsTitle: '纸质专业真题',
      responseExtras: {},
    });

    expect(order.pay_payload.wechat_pay).toEqual(
      expect.objectContaining({
        out_trade_no: 'ORDER1',
        sub_mch_id: 'new-sub-mch',
        callback_env_id: 'prod-env',
        callback_service: 'prod',
        callback_path: '/api/app/order/pay/notify',
      }),
    );
  });

  it('reuses the original callback route when retrying the same WeChat Pay order', async () => {
    const service = createService();
    service.getCloudPayConfig = jest.fn(() => ({
      subAppid: 'wx-test',
      subMchId: 'current-sub-mch',
      callbackEnvId: 'current-env',
      callbackService: 'current-service',
      callbackPath: '/current/notify',
      spbillCreateIp: '127.0.0.1',
    }));
    service.createWechatPayPaymentParams = jest.fn().mockResolvedValue({
      timeStamp: '2',
      nonceStr: 'retry-nonce',
      package: 'prepay_id=retry',
      signType: 'MD5',
      paySign: 'retry-sign',
    });

    const order: any = {
      order_no: 'ORDER_RETRY',
      amount: 19,
      status: OrderStatus.PENDING,
      pay_payload: {
        wechat_pay: {
          sub_mch_id: 'original-sub-mch',
          callback_env_id: 'original-env',
          callback_service: 'original-service',
          callback_path: '/original/notify',
        },
      },
    };

    await service.processWechatPayPayment({
      user: { id: 1, openid: 'openid' },
      order,
      goodsTitle: '纸质资料',
      responseExtras: {},
    });

    expect(service.createWechatPayPaymentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          subMchId: 'original-sub-mch',
          callbackEnvId: 'original-env',
          callbackService: 'original-service',
          callbackPath: '/original/notify',
        }),
      }),
    );
    expect(order.pay_payload.wechat_pay).toEqual(
      expect.objectContaining({
        callback_env_id: 'original-env',
        callback_service: 'original-service',
        callback_path: '/original/notify',
      }),
    );
  });

  it('maps WeChat Pay refund authorization errors to an actionable message', () => {
    const service = createService();

    const message = service.getWechatPayErrorMessage(
      {
        err_code: 'NO_AUTH',
        err_code_des: '特约子商户商户号未授权服务商的产品权限',
      },
      '微信支付refund接口失败',
      'refund',
    );

    expect(message).toBe('微信支付退款权限未授权：请在微信云开发/云托管支付设置中发起“退款 API”授权，并在微信支付商户平台同意授权后重试');
    expect(() => {
      throw new BadRequestException(message);
    }).toThrow(BadRequestException);
  });

  it('masks WeChat Pay identifiers in refund logs', () => {
    const service = createService();

    const masked = service.maskWechatPayRequest({
      sub_mch_id: '1111726570',
      transaction_id: '4500000274202607068293307737',
      out_refund_no: 'ORDER17832972611920965_WX_RF',
      nonce_str: '306695452f731b6ebcdc47ba8b060025',
      refund_fee: 7500,
    });

    expect(masked.sub_mch_id).toBe('111172***6570');
    expect(masked.transaction_id).toBe('450000***7737');
    expect(masked.out_refund_no).toBe('ORDER1***X_RF');
    expect(masked.nonce_str).toBe('306695***0025');
    expect(masked.refund_fee).toBe(7500);
  });

  it('allows refunding paid orders directly from admin order list', async () => {
    const service = createService();
    const order = {
      id: 88,
      order_no: 'ORDER_PAID_REFUND',
      user_id: 7,
      course_id: 10,
      amount: 80,
      status: OrderStatus.PAID,
      pay_provider: 'wechat_pay',
      pay_payload: {},
    };
    service.orderRepository.findOne = jest.fn().mockResolvedValue(order);
    service.appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 7, openid: 'openid' }),
    };
    service.coinService = {
      yuanToCoinInt: jest.fn(() => 8000),
    };
    service.userCourseAuthRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.afterSaleRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.refundWechatPayOrder = jest.fn().mockResolvedValue({ return_code: 'SUCCESS' });
    service.distributorService = {
      cancelOrderCommission: jest.fn().mockResolvedValue(undefined),
    };

    const result = await service.refundOrder(88, 1, { remark: '管理员直接退款' });

    expect(service.refundWechatPayOrder).toHaveBeenCalledWith(
      order,
      'ORDER_PAID_REFUND_WX_RF',
      '管理员直接退款',
    );
    expect(service.userCourseAuthRepository.delete).toHaveBeenCalledWith({
      user_id: 7,
      course_id: 10,
      source: 'purchase',
    });
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect((order.pay_payload as any).refund).toEqual(
      expect.objectContaining({
        admin_id: 1,
        remark: '管理员直接退款',
        wechat_pay_refund_order_id: 'ORDER_PAID_REFUND_WX_RF',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        message: '退款成功',
        order_no: 'ORDER_PAID_REFUND',
        status: OrderStatus.CANCELLED,
      }),
    );
  });

  it('rejects refunding unpaid orders', async () => {
    const service = createService();
    service.orderRepository.findOne = jest.fn().mockResolvedValue({
      id: 89,
      order_no: 'ORDER_PENDING_REFUND',
      status: OrderStatus.PENDING,
      pay_payload: {},
    });

    await expect(service.refundOrder(89, 1)).rejects.toThrow('仅已支付或售后中的订单可退款');
  });
});

describe('OrderService admin pagination', () => {
  it('excludes paper fulfillment orders from digital course content filters', async () => {
    const query: any = {
      leftJoin: jest.fn(),
      select: jest.fn(),
      orderBy: jest.fn(),
      andWhere: jest.fn(),
      clone: jest.fn(),
      getCount: jest.fn().mockResolvedValue(0),
      offset: jest.fn(),
      limit: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    Object.keys(query).forEach((key) => {
      if (!['getCount', 'getRawMany'].includes(key)) query[key].mockReturnValue(query);
    });

    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = { createQueryBuilder: jest.fn().mockReturnValue(query) };
    service.getLatestAfterSaleMap = jest.fn().mockResolvedValue(new Map());

    await service.getAdminOrderList({ page: 1, pageSize: 10, content_type: 'file' });

    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("$.fulfillment_type"),
      { excludedPaperFulfillmentType: 'paper' },
    );
  });

  it('honors the 100-row page size exposed by the admin table', async () => {
    const query: any = {
      leftJoin: jest.fn(),
      select: jest.fn(),
      orderBy: jest.fn(),
      andWhere: jest.fn(),
      clone: jest.fn(),
      getCount: jest.fn().mockResolvedValue(0),
      offset: jest.fn(),
      limit: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    Object.keys(query).forEach((key) => {
      if (!['getCount', 'getRawMany'].includes(key)) {
        query[key].mockReturnValue(query);
      }
    });

    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = { createQueryBuilder: jest.fn().mockReturnValue(query) };
    service.getLatestAfterSaleMap = jest.fn().mockResolvedValue(new Map());

    const result = await service.getAdminOrderList({ page: 1, pageSize: 100 });

    expect(query.limit).toHaveBeenCalledWith(100);
    expect(result.pageSize).toBe(100);
  });

  it('applies paper-only and cloud-print filters before pagination', async () => {
    const query: any = {
      leftJoin: jest.fn(),
      select: jest.fn(),
      orderBy: jest.fn(),
      andWhere: jest.fn(),
      clone: jest.fn(),
      getCount: jest.fn().mockResolvedValue(0),
      offset: jest.fn(),
      limit: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    Object.keys(query).forEach((key) => {
      if (!['getCount', 'getRawMany'].includes(key)) query[key].mockReturnValue(query);
    });

    const service = Object.create(OrderService.prototype) as any;
    service.orderRepository = { createQueryBuilder: jest.fn().mockReturnValue(query) };
    service.getLatestAfterSaleMap = jest.fn().mockResolvedValue(new Map());

    await service.getAdminOrderList({
      page: 1,
      pageSize: 10,
      paper_only: true,
      cloud_print_status: 'retryable_failed',
    });

    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("$.fulfillment_type"),
      { paperFulfillmentType: 'paper', paperContentType: 'paper_exam' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("$.cloud_print.status"),
      { cloudPrintStatus: 'retryable_failed' },
    );
    expect(query.offset).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(10);
  });
});

describe('OrderService paper exam checkout', () => {
  const shippingAddress = {
    name: '张三',
    phone: '13800138000',
    province: '安徽省',
    city: '合肥市',
    district: '蜀山区',
    detail: '测试路 1 号',
  };

  const createCheckoutService = () => {
    const service = Object.create(OrderService.prototype) as any;
    service.generateOrderNo = jest.fn(() => 'ORDER_PAPER_1');
    service.orderRepository = {
      create: jest.fn((order) => ({ id: 1, ...order })),
      findOne: jest.fn(),
      save: jest.fn(async (order) => order),
    };
    service.courseRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    service.appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 7, openid: 'openid' }),
    };
    service.userCourseAuthRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.packageService = {
      userHasCourseAccessViaPackage: jest.fn().mockResolvedValue(false),
    };
    service.categoryBundleAccessService = {
      userHasCourseAccess: jest.fn().mockResolvedValue(false),
    };
    service.referralCouponService = {
      validateCouponForOrder: jest.fn(),
    };
    service.processWechatPayPayment = jest.fn().mockResolvedValue({
      order_no: 'ORDER_PAPER_1',
      pay_provider: 'wechat_pay',
      payment_params: { timeStamp: '1' },
    });
    service.processCoinBasedPayment = jest.fn();
    return service;
  };

  it('requires a shipping address before creating a paper exam order', async () => {
    const service = createCheckoutService();
    service.courseRepository.findOne.mockResolvedValue({
      id: 10,
      name: '安徽理工大学812电路',
      price: 80,
      is_free: 0,
      content_type: 'paper_exam',
    });

    await expect(service.createOrder(7, { course_id: 10 })).rejects.toThrow('纸质专业真题需要填写收货地址');
    expect(service.processWechatPayPayment).not.toHaveBeenCalled();
  });

  it('creates a paper exam order with shipping address and WeChat Pay provider', async () => {
    const service = createCheckoutService();
    service.courseRepository.findOne.mockResolvedValue({
      id: 10,
      name: '安徽理工大学812电路',
      price: 80,
      is_free: 0,
      content_type: 'paper_exam',
    });

    await service.createOrder(7, {
      course_id: 10,
      shipping_address: shippingAddress,
    });

    expect(service.orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        course_id: 10,
        amount: 80,
        pay_provider: 'wechat_pay',
        shipping_address: expect.objectContaining({
          name: '张三',
          phone: '13800138000',
          detail: '测试路 1 号',
        }),
      }),
    );
    expect(service.processWechatPayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        goodsTitle: '安徽理工大学812电路',
        order: expect.objectContaining({ pay_provider: 'wechat_pay' }),
      }),
    );
    expect(service.processCoinBasedPayment).not.toHaveBeenCalled();
  });

  it('uses WeChat Pay for a cart order when any selected course is paper exam', async () => {
    const service = createCheckoutService();
    service.courseRepository.find.mockResolvedValue([
      {
        id: 10,
        name: '安徽理工大学812电路',
        price: 80,
        is_free: 0,
        content_type: 'paper_exam',
      },
      {
        id: 11,
        name: '普通课程',
        price: 5,
        is_free: 0,
        content_type: 'normal',
      },
    ]);

    await service.createCartOrder(7, {
      course_ids: [10, 11],
      shipping_address: shippingAddress,
    });

    expect(service.orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 85,
        pay_provider: 'wechat_pay',
        shipping_address: expect.objectContaining({ phone: '13800138000' }),
        pay_payload: expect.objectContaining({
          is_cart: true,
          cart_items: expect.arrayContaining([
            expect.objectContaining({ course_id: 10, content_type: 'paper_exam' }),
            expect.objectContaining({ course_id: 11, content_type: 'normal' }),
          ]),
        }),
      }),
    );
    expect(service.processWechatPayPayment).toHaveBeenCalled();
    expect(service.processCoinBasedPayment).not.toHaveBeenCalled();
  });

  it('reroutes legacy pending paper exam orders to WeChat Pay when continuing payment', async () => {
    const service = createCheckoutService();
    const legacyOrder = {
      id: 20,
      order_no: 'ORDER_LEGACY_PAPER',
      user_id: 7,
      amount: 80,
      course_id: 10,
      order_type: 'course',
      status: OrderStatus.PENDING,
      pay_provider: 'virtual_payment',
      shipping_address: shippingAddress,
      pay_payload: {
        payment_params: {
          virtual_payment: {
            mode: 'short_series_goods',
          },
        },
      },
    };
    service.orderRepository.findOne.mockResolvedValue(legacyOrder);
    service.courseRepository.findOne.mockResolvedValue({
      id: 10,
      name: '安徽理工大学812电路',
      price: 80,
      is_free: 0,
      content_type: 'paper_exam',
    });
    service.tryFulfillVirtualPaymentOrder = jest.fn();

    await service.payPendingOrder(7, 20);

    expect(service.processWechatPayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        order: legacyOrder,
        goodsTitle: '安徽理工大学812电路',
        responseExtras: expect.objectContaining({
          course_id: 10,
          order_type: 'course',
        }),
      }),
    );
    expect(service.tryFulfillVirtualPaymentOrder).not.toHaveBeenCalled();
    expect(service.processCoinBasedPayment).not.toHaveBeenCalled();
  });
});

describe('OrderService WeChat express logistics', () => {
  const baseOrder: any = {
    id: 30,
    order_no: 'ORDER_WECHAT_EXPRESS',
    user_id: 7,
    course_id: 10,
    tracking_no: 'SF123456789',
    shipper_code: 'SF',
    shipping_address: {
      name: '张三',
      phone: '13800138000',
      province: '安徽省',
      city: '合肥市',
      district: '蜀山区',
      detail: '测试路 1 号',
    },
    pay_payload: {
      wechat_pay_callback: {
        transactionId: '4200000000000000000',
      },
    },
    logistics_snapshot: null,
  };

  const createLogisticsService = () => {
    const service = Object.create(OrderService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          WECHAT_EXPRESS_GOODS_IMAGE_URL: 'https://example.com/goods.png',
          WECHAT_EXPRESS_ORDER_DETAIL_PATH: 'pages/sub-pages/order/index?status=paid&order_id={orderId}',
        };
        return values[key];
      }),
    };
    service.appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 7, openid: 'openid' }),
    };
    service.courseRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 10, name: '安徽理工大学812电路', cover_img: '' }),
    };
    service.xpayService = {
      getWechatAccessTokenForServerApi: jest.fn().mockResolvedValue('access-token'),
    };
    service.callWechatExpressApi = jest
      .fn()
      .mockResolvedValueOnce({ errcode: 0, waybill_token: 'trace-token' })
      .mockResolvedValueOnce({ errcode: 0, waybill_token: 'follow-token' })
      .mockResolvedValueOnce({
        errcode: 0,
        waybill_info: { status: 2, waybill_id: 'SF123456789' },
        delivery_info: { delivery_name: '顺丰速运' },
      });
    return service;
  };

  it('attaches WeChat express waybill tokens for shipped paper orders', async () => {
    const service = createLogisticsService();
    const snapshot = await service.attachWechatExpressSnapshot(
      { ...baseOrder },
      {
        provider: 'kdniao',
        configured: false,
        success: false,
        trackingNo: 'SF123456789',
        traces: [],
        queriedAt: '2026-07-07T00:00:00.000Z',
      },
      { syncMessage: true },
    );

    expect(snapshot.wechat).toEqual(
      expect.objectContaining({
        configured: true,
        success: true,
        trackingSuccess: true,
        messageSuccess: true,
        waybillToken: 'trace-token',
        followWaybillToken: 'follow-token',
        status: 2,
        statusText: '运输中',
        deliveryName: '顺丰速运',
      }),
    );
    expect(service.callWechatExpressApi).toHaveBeenCalledWith(
      '/cgi-bin/express/delivery/open_msg/trace_waybill',
      expect.objectContaining({
        openid: 'openid',
        receiver_phone: '13800138000',
        waybill_id: 'SF123456789',
        trans_id: '4200000000000000000',
        order_detail_path: 'pages/sub-pages/order/index?status=paid&order_id=30',
      }),
    );
    expect(service.callWechatExpressApi.mock.calls[0][1].goods_info.detail_list[0]).toEqual(
      expect.objectContaining({
        goods_name: '安徽理工大学812电路',
        goods_img_url: 'https://example.com/goods.png',
      }),
    );
  });

  it('keeps logistics query usable when WeChat express image is not configured', async () => {
    const service = createLogisticsService();
    service.configService.get = jest.fn(() => '');

    const snapshot = await service.attachWechatExpressSnapshot(
      { ...baseOrder },
      {
        provider: 'kdniao',
        configured: false,
        success: false,
        trackingNo: 'SF123456789',
        traces: [],
        queriedAt: '2026-07-07T00:00:00.000Z',
      },
      { syncMessage: true },
    );

    expect(snapshot.wechat).toEqual(
      expect.objectContaining({
        configured: true,
        success: false,
        message: '微信物流商品图片未配置',
      }),
    );
    expect(service.callWechatExpressApi).not.toHaveBeenCalled();
  });

  it('does not report message delivery as successful when only the tracking token was created', async () => {
    const service = createLogisticsService();
    service.callWechatExpressApi = jest
      .fn()
      .mockResolvedValueOnce({ errcode: 0, waybill_token: 'trace-token' })
      .mockRejectedValueOnce(new Error('follow failed'))
      .mockResolvedValueOnce({ errcode: 0, waybill_info: { status: 1 } });

    const snapshot = await service.attachWechatExpressSnapshot(
      { ...baseOrder },
      {
        provider: 'kdniao',
        configured: false,
        success: false,
        trackingNo: 'SF123456789',
        traces: [],
        queriedAt: '2026-07-07T00:00:00.000Z',
      },
      { syncMessage: true },
    );

    expect(snapshot.wechat).toEqual(
      expect.objectContaining({
        success: false,
        trackingSuccess: true,
        messageSuccess: false,
        waybillToken: 'trace-token',
        messageError: '消息能力传运单失败：follow failed',
      }),
    );
  });

  it('retries only the missing message binding for the same waybill', async () => {
    const service = createLogisticsService();
    service.callWechatExpressApi = jest
      .fn()
      .mockResolvedValueOnce({ errcode: 0, waybill_token: 'follow-token' })
      .mockResolvedValueOnce({ errcode: 0, waybill_info: { status: 2 } });
    const order = {
      ...baseOrder,
      logistics_snapshot: {
        wechat: {
          trackingNo: 'SF123456789',
          waybillToken: 'trace-token',
          messageSuccess: false,
          messageError: '消息能力传运单失败：temporary error',
        },
      },
    };

    const snapshot = await service.attachWechatExpressSnapshot(
      order,
      {
        provider: 'kdniao',
        configured: false,
        success: false,
        trackingNo: 'SF123456789',
        traces: [],
        queriedAt: '2026-07-07T00:00:00.000Z',
      },
      { syncMessage: true },
    );

    expect(service.callWechatExpressApi).toHaveBeenCalledTimes(2);
    expect(service.callWechatExpressApi.mock.calls[0][0]).toBe(
      '/cgi-bin/express/delivery/open_msg/follow_waybill',
    );
    expect(snapshot.wechat).toEqual(
      expect.objectContaining({
        success: true,
        trackingSuccess: true,
        messageSuccess: true,
        messageError: '',
      }),
    );
  });

  it('calls the WeChat express API without inheriting an environment proxy', async () => {
    const service = createLogisticsService();
    service.callWechatExpressApi = OrderService.prototype['callWechatExpressApi'].bind(service);
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { errcode: 0, waybill_token: 'token' } });

    await service.callWechatExpressApi('/cgi-bin/express/delivery/open_msg/follow_waybill', { waybill_id: 'SF1' });

    expect(post).toHaveBeenCalledWith(
      'https://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/follow_waybill',
      { waybill_id: 'SF1' },
      expect.objectContaining({ proxy: false }),
    );
    post.mockRestore();
  });

  it('uses the WeChat Cloud Run internal API route when the platform environment is injected', async () => {
    const previousCloudRunEnv = process.env.WX_CLOUD_RUN_ENV;
    process.env.WX_CLOUD_RUN_ENV = 'true';
    const service = createLogisticsService();
    service.callWechatExpressApi = OrderService.prototype['callWechatExpressApi'].bind(service);
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { errcode: 0, waybill_token: 'token' } });

    try {
      await service.callWechatExpressApi('/cgi-bin/express/delivery/open_msg/follow_waybill', { waybill_id: 'SF1' });

      expect(post).toHaveBeenCalledWith(
        'http://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/follow_waybill',
        { waybill_id: 'SF1' },
        expect.objectContaining({ proxy: false }),
      );
    } finally {
      if (previousCloudRunEnv === undefined) {
        delete process.env.WX_CLOUD_RUN_ENV;
      } else {
        process.env.WX_CLOUD_RUN_ENV = previousCloudRunEnv;
      }
      post.mockRestore();
    }
  });

  it('retries message binding when logistics is refreshed and uses the detected carrier first', async () => {
    const service = createLogisticsService();
    const order = { ...baseOrder, shipper_code: null, shipper_name: null };
    service.orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (value) => value),
    };
    service.orderRequiresShipping = jest.fn().mockResolvedValue(true);
    service.queryLogisticsSnapshot = jest.fn().mockResolvedValue({
      provider: 'kdniao',
      configured: true,
      success: true,
      trackingNo: 'SF123456789',
      shipperCode: 'SF',
      shipperName: '顺丰速运',
      traces: [],
      queriedAt: '2026-07-07T00:00:00.000Z',
    });
    service.attachWechatExpressSnapshot = jest.fn(async (currentOrder, snapshot, options) => ({
      ...snapshot,
      wechat: { configured: true, success: true, queriedAt: snapshot.queriedAt },
      carrierSeenByWechat: currentOrder.shipper_code,
      syncMessage: options.syncMessage,
    }));

    const snapshot = await service.queryOrderLogistics(order.id);

    expect(service.attachWechatExpressSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ shipper_code: 'SF', shipper_name: '顺丰速运' }),
      expect.any(Object),
      { syncMessage: true },
    );
    expect(snapshot).toEqual(expect.objectContaining({ carrierSeenByWechat: 'SF', syncMessage: true }));
  });
});
