import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CloudPrintService } from '../cloud-print/cloud-print.service';
import { OrderService } from './order.service';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { CourseFile } from '../../database/entities/course-file.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { OrderAfterSale } from '../../database/entities/order-after-sale.entity';
import { DistributorService } from '../distributor/distributor.service';
import { XpayService } from './xpay.service';
import { ReferralCouponService } from '../marketing/referral-coupon.service';
import { PackageService } from '../package/package.service';
import { CategoryBundleAccessService } from '../category-bundle-access/category-bundle-access.service';
import { CoinService } from './coin.service';

describe('OrderService paper cart', () => {
  let module: TestingModule;
  let service: any;
  let repos: Map<any, any>;
  let packageAccess: any;
  let categoryAccess: any;
  let commission: any;
  let savedOrder: any;
  const address = { name: '测试用户', phone: '13800138000', province: '上海市', city: '上海市', district: '浦东新区', detail: '测试路 1 号' };
  const dto = () => ({ items: [{ course_id: 9, quantity: 2 }, { course_id: 10, quantity: 3 }],
    shipping_address: { ...address }, expected_amount: 150 });
  const courses = () => [9, 10].map((id) => ({ id, status: 1, content_type: 'file', is_free: 0, price: 5, name: `资料${id}` }));
  const params = { timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=test', signType: 'MD5', paySign: 'test' };

  beforeEach(async () => {
    savedOrder = null;
    repos = new Map([Order, Course, CourseCategory, CourseFile, AppUser, UserCourseAuth, OrderAfterSale].map((entity) => [entity, {
      find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn((value) => ({ id: 101, ...value })),
      save: jest.fn(async (value) => value), delete: jest.fn(),
    }]));
    repos.get(Course).find.mockResolvedValue(courses());
    repos.get(Course).findOne.mockResolvedValue(courses()[0]);
    repos.get(CourseFile).find.mockResolvedValue([
      { id: 91, course_id: 9, file_type: 'pdf', file_page_count: 22 },
      { id: 101, course_id: 10, file_type: 'pdf', file_page_count: 382 },
    ]);
    repos.get(AppUser).findOne.mockResolvedValue({ id: 7, openid: 'openid' });
    repos.get(UserCourseAuth).find.mockResolvedValue([{ course_id: 9 }, { course_id: 10 }]);
    repos.get(Order).save.mockImplementation(async (order) => (savedOrder = order));
    repos.get(Order).findOne.mockImplementation(async () => savedOrder);
    packageAccess = { batchUserHasCourseAccessViaPackage: jest.fn().mockResolvedValue(new Map()) };
    categoryAccess = { batchUserHasCourseAccess: jest.fn().mockResolvedValue(new Map()) };
    commission = { processOrderCommission: jest.fn() };
    module = await Test.createTestingModule({ providers: [OrderService,
      ...[...repos].map(([entity, value]) => ({ provide: getRepositoryToken(entity), useValue: value })),
      { provide: DistributorService, useValue: commission },
      { provide: XpayService, useValue: {} }, { provide: ReferralCouponService, useValue: {} },
      { provide: PackageService, useValue: packageAccess },
      { provide: CategoryBundleAccessService, useValue: categoryAccess },
      { provide: CoinService, useValue: { yuanToCoinInt: jest.fn((amount) => amount * 100) } },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: CloudPrintService, useValue: {
        enqueuePaidOrder: jest.fn().mockResolvedValue(null),
        reserveRefund: jest.fn().mockResolvedValue(null),
      } },
    ] }).compile();
    service = module.get(OrderService);
    jest.spyOn(service, 'getCloudPayConfig').mockReturnValue({ subMchId: 'test' });
    jest.spyOn(service, 'createWechatPayPaymentParams').mockResolvedValue(params);
    jest.spyOn(service, 'processCoinBasedPayment');
    jest.spyOn(service, 'grantCourseAccess');
    jest.spyOn(service, 'revokeCourseAccess');
  });

  afterEach(async () => { await module.close(); });

  it('creates one order and one WeChat payment from batch-cached prices and quantities', async () => {
    const result = await service.createPaperCartOrder(7, dto(), '127.0.0.1');
    expect(result).toMatchObject({ amount: 150, fulfillment_type: 'paper', is_cart: true,
      course_ids: [9, 10], pay_provider: 'wechat_pay', payment_params: params });
    expect(savedOrder).toMatchObject({ amount: 150, original_amount: 150, discount_amount: 0, coupon_id: null,
      shipping_address: address, pay_payload: { fulfillment_type: 'paper', is_cart: true,
        material_amount: 150, regional_shipping_fee: 0, regional_shipping_region: null,
        cart_items: [
          { course_id: 9, quantity: 2, unit_price: 12, price: 24, total_price: 24, total_pages: 22 },
          { course_id: 10, quantity: 3, unit_price: 42, price: 126, total_price: 126, total_pages: 382 },
        ], wechat_pay: { body: '纸质资料 2 种 5 份', total_fee: 15000 } } });
    expect(savedOrder.pay_payload.cart_items[0].pricing_formula.rounding_mode).toBe('ceil_yuan');
    expect(repos.get(Order).create).toHaveBeenCalledTimes(1);
    expect(service.createWechatPayPaymentParams).toHaveBeenCalledTimes(1);
    expect(service.processCoinBasedPayment).not.toHaveBeenCalled();
    expect(repos.get(CourseFile).find).toHaveBeenCalledTimes(1);
    expect(repos.get(UserCourseAuth).find).toHaveBeenCalledTimes(1);
    expect(packageAccess.batchUserHasCourseAccessViaPackage).toHaveBeenCalledTimes(1);
    expect(categoryAccess.batchUserHasCourseAccess).toHaveBeenCalledTimes(1);
  });

  it('adds the regional shipping fee once for a configured province', async () => {
    const regionalAddress = { ...address, province: '新疆维吾尔自治区', city: '乌鲁木齐市' };
    await expect(service.createPaperCartOrder(7, {
      ...dto(),
      shipping_address: regionalAddress,
      expected_amount: 150,
    })).rejects.toThrow('价格已变化');
    expect(repos.get(Order).save).not.toHaveBeenCalled();

    const result = await service.createPaperCartOrder(7, {
      ...dto(),
      shipping_address: regionalAddress,
      expected_amount: 158,
    });

    expect(result.amount).toBe(158);
    expect(savedOrder).toMatchObject({
      amount: 158,
      original_amount: 158,
      shipping_address: regionalAddress,
      pay_payload: {
        material_amount: 150,
        regional_shipping_fee: 8,
        regional_shipping_region: '新疆',
      },
    });
    expect(savedOrder.pay_payload.cart_items.reduce((sum, item) => sum + item.total_price, 0)).toBe(150);
  });

  it.each([[], [{ course_id: 9, quantity: 0 }], [{ course_id: 9, quantity: 100 }],
    [{ course_id: 9, quantity: 1.5 }], [{ course_id: 9, quantity: '2' }], [{ course_id: '9', quantity: 1 }],
    [{ course_id: 9, quantity: 1 }, { course_id: 9, quantity: 2 }],
  ].map((items) => ({ items })))('rejects invalid items before writing any order %#', async ({ items }) => {
    await expect(service.createPaperCartOrder(7, { ...dto(), items })).rejects.toThrow();
    expect(repos.get(Order).save).not.toHaveBeenCalled();
    expect(service.createWechatPayPaymentParams).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { ...address, district: '' }])('requires a complete address %#', async (shipping_address) => {
    await expect(service.createPaperCartOrder(7, { ...dto(), shipping_address })).rejects.toThrow();
    expect(repos.get(Order).save).not.toHaveBeenCalled();
  });

  it.each([{ status: 0 }, { content_type: 'normal' }, { is_free: 1 }, { price: 0 }])('rejects unavailable or non-paid file courses %j', async (change) => {
    repos.get(Course).find.mockResolvedValue([{ ...courses()[0], ...change }, courses()[1]]);
    await expect(service.createPaperCartOrder(7, dto())).rejects.toThrow('仅支持已上架的付费文件课程');
    expect(repos.get(Order).save).not.toHaveBeenCalled();
  });

  it('rejects unowned and expired courses before creating an order', async () => {
    repos.get(UserCourseAuth).find.mockResolvedValue([{ course_id: 9 }, { course_id: 10, expire_time: new Date(0) }]);
    await expect(service.createPaperCartOrder(7, dto())).rejects.toThrow('当前已拥有');
    expect(repos.get(Order).save).not.toHaveBeenCalled();
  });

  it('rejects deleted courses without creating a partial order', async () => {
    repos.get(Course).find.mockResolvedValue([courses()[0]]);
    await expect(service.createPaperCartOrder(7, dto())).rejects.toThrow('部分资料不存在或已下架');
    expect(repos.get(Order).save).not.toHaveBeenCalled();
  });

  it('accepts current package and category ownership without direct auth', async () => {
    repos.get(UserCourseAuth).find.mockResolvedValue([]);
    packageAccess.batchUserHasCourseAccessViaPackage.mockResolvedValue(new Map([[9, { hasAccess: true }]]));
    categoryAccess.batchUserHasCourseAccess.mockResolvedValue(new Map([[10, {}]]));
    await expect(service.createPaperCartOrder(7, dto())).resolves.toMatchObject({ amount: 150 });
  });

  it('rejects unknown page counts and changed total prices without writing an order', async () => {
    await expect(service.createPaperCartOrder(7, { ...dto(), expected_amount: 149 })).rejects.toThrow('价格已变化');
    repos.get(CourseFile).find.mockResolvedValue([{ course_id: 9, file_type: 'pdf', file_page_count: 22 }]);
    await expect(service.createPaperCartOrder(7, dto())).rejects.toThrow('资料页数核算中');
    expect(repos.get(Order).save).not.toHaveBeenCalled();
  });

  it('rejects coupons instead of discounting paper orders', async () => {
    await expect(service.createPaperCartOrder(7, { ...dto(), coupon_id: 2 })).rejects.toThrow('不能使用优惠券');
    expect(repos.get(Order).save).not.toHaveBeenCalled();
  });

  it('retains one pending order on payment failure and resumes payment with the same paper snapshot', async () => {
    const warn = jest.spyOn(service.logger, 'warn').mockImplementation(() => undefined);
    service.createWechatPayPaymentParams.mockRejectedValueOnce(new Error('sensitive provider response'));
    const pending = await service.createPaperCartOrder(7, dto());
    expect(pending).toMatchObject({ order_no: savedOrder.order_no, amount: 150,
      status: OrderStatus.PENDING, pay_provider: 'wechat_pay', payment_params: null,
      fulfillment_type: 'paper', is_cart: true, course_ids: [9, 10],
      payment_error: '订单已创建，暂时无法发起支付，请前往订单页继续支付，请勿重复下单' });
    expect(JSON.stringify(pending)).not.toContain('sensitive');
    expect(warn).toHaveBeenCalledWith({ event: 'PAPER_CART_PAYMENT_PREPARATION_FAILED', orderId: savedOrder.id });
    expect(repos.get(Order).save).toHaveBeenCalledTimes(1);
    expect(service.createWechatPayPaymentParams).toHaveBeenCalledTimes(1);
    expect(savedOrder.status).toBe(OrderStatus.PENDING);
    const orderNo = savedOrder.order_no;
    const result = await service.payPendingOrder(7, savedOrder.id);
    expect(result).toMatchObject({ order_no: orderNo, fulfillment_type: 'paper', amount: 150 });
    expect(repos.get(Order).create).toHaveBeenCalledTimes(1);
    expect(service.createWechatPayPaymentParams).toHaveBeenLastCalledWith(expect.objectContaining({ goodsTitle: '纸质资料 2 种 5 份' }));
    expect(service.processCoinBasedPayment).not.toHaveBeenCalled();
  });

  it('does not return a pending order when initial persistence failed', async () => {
    repos.get(Order).save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.createPaperCartOrder(7, dto())).rejects.toThrow('database unavailable');
    expect(service.createWechatPayPaymentParams).not.toHaveBeenCalled();
  });

  it('does not grant or revoke electronic rights when a paper cart is paid/refunded', async () => {
    await service.createPaperCartOrder(7, dto());
    await service.handlePaymentSuccess(savedOrder.id);
    await service.handlePaymentSuccess(savedOrder.id);
    await service.revokeOrderAccess(savedOrder);
    expect(savedOrder.status).toBe(OrderStatus.PAID);
    expect(service.grantCourseAccess).not.toHaveBeenCalled();
    expect(service.revokeCourseAccess).not.toHaveBeenCalled();
    // Payment callbacks may be retried; the commission service enforces idempotency.
    expect(commission.processOrderCommission).toHaveBeenCalledTimes(2);
  });

  it('refunds an after-sale paper cart in full once without revoking existing courses', async () => {
    await service.createPaperCartOrder(7, dto());
    await service.handlePaymentSuccess(savedOrder.id);
    savedOrder.status = OrderStatus.AFTER_SALE;
    jest.spyOn(service, 'refundWechatPayOrder').mockResolvedValue({ result_code: 'SUCCESS' });
    const result = await service.refundOrder(savedOrder.id, 1, { remark: '测试退款' });
    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(service.refundWechatPayOrder).toHaveBeenCalledTimes(1);
    expect(service.refundWechatPayOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 150 }), expect.any(String), '测试退款');
    expect(service.revokeCourseAccess).not.toHaveBeenCalled();
    expect(savedOrder.pay_payload.cart_items).toHaveLength(2);
    await expect(service.refundOrder(savedOrder.id, 1, {})).rejects.toThrow('该订单已退款');
    expect(service.refundWechatPayOrder).toHaveBeenCalledTimes(1);
  });

  it('ships all paper items together with one tracking number and keeps the pricing snapshot', async () => {
    await service.createPaperCartOrder(7, dto());
    await service.handlePaymentSuccess(savedOrder.id);
    jest.spyOn(service, 'queryLogisticsSnapshot').mockResolvedValue({ configured: false, success: false, traces: [] });
    jest.spyOn(service, 'attachWechatExpressSnapshot').mockImplementation(async (_order, snapshot) => snapshot);
    const result = await service.shipOrder(savedOrder.id,
      { tracking_no: 'TEST123', shipper_code: 'SF' }, { operatorType: 'admin', operatorId: 1 });
    expect(result).toMatchObject({ trackingNo: 'TEST123', deliveryStatus: 'shipped' });
    expect(savedOrder.pay_payload.cart_items).toHaveLength(2);
    expect(service.attachWechatExpressSnapshot).toHaveBeenCalledTimes(1);
    expect(service.getWechatExpressGoodsName(savedOrder)).toBe('纸质资料 2 种 5 份');
  });

  it('keeps quantities/pricing in app/admin mappings and logistics title, including one selected item', async () => {
    await service.createPaperCartOrder(7, dto());
    const row = { id: 101, courseName: '资料9', contentType: 'file', payPayload: savedOrder.pay_payload };
    const admin = service.mapAdminOrderRow(row);
    expect(admin).toMatchObject({ productName: '纸质资料 2 种 5 份', requiresShipping: true, isCart: true, fulfillmentType: 'paper',
      cartItems: [ { courseId: 9, quantity: 2, unitPrice: 12, price: 24, totalPrice: 24, totalPages: 22 },
        { courseId: 10, quantity: 3, unitPrice: 42, price: 126, totalPrice: 126, totalPages: 382 } ] });
    const qb: any = { getRawMany: jest.fn().mockResolvedValue([row]) };
    for (const key of ['leftJoin', 'select', 'where', 'orderBy']) qb[key] = jest.fn(() => qb);
    repos.get(Order).createQueryBuilder = jest.fn(() => qb);
    const [app] = await service.getOrderList(7);
    expect(app).toMatchObject({ cartItems: admin.cartItems, productName: admin.productName, requiresShipping: true });
    expect(service.getWechatExpressGoodsName(savedOrder)).toBe('纸质资料 2 种 5 份');
    expect(await service.orderRequiresShipping({ pay_payload: savedOrder.pay_payload })).toBe(true);
    savedOrder.pay_payload.cart_items.pop();
    expect(service.mapAdminOrderRow(row)).toMatchObject({ productName: '纸质资料 1 种 2 份', isCart: true });
  });

  it('retains legacy electronic cart title/prices and normalizes historical camelCase fields', () => {
    expect(service.mapAdminOrderRow({ payPayload: { cart_items: [
      { course_id: 9, name: '课程9', price: 5, content_type: 'normal' },
      { courseId: 10, name: '课程10', price: 8, contentType: 'file' },
    ] } })).toMatchObject({ productName: '购物车(2门课程)', requiresShipping: false,
      cartItems: [{ courseId: 9, quantity: 1, unitPrice: 5, totalPrice: 5 },
        { courseId: 10, quantity: 1, unitPrice: 8, totalPrice: 8 }] });
  });
});
