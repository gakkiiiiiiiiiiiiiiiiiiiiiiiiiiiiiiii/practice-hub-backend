import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderStatus } from '../../database/entities/order.entity';

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
});
