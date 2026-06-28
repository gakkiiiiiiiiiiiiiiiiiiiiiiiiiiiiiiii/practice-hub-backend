import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';
import axios from 'axios';
import { Order, OrderDeliveryStatus, OrderShippingAddress, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateCartOrderDto } from './dto/create-cart-order.dto';
import { GetAdminOrderListDto } from './dto/get-admin-order-list.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { OrderAfterSale, AfterSaleStatus } from '../../database/entities/order-after-sale.entity';
import { DistributorService } from '../distributor/distributor.service';
import { XpayService } from './xpay.service';
import { ReferralCouponService } from '../marketing/referral-coupon.service';
import { PackageService } from '../package/package.service';
import { CoinService } from './coin.service';
import { normalizePayAmountYuan, assertIntegerYuanPrice } from '../../common/utils/price.util';

type ShipOrderActor = {
  operatorType: 'admin' | 'app_admin';
  operatorId?: number;
};

type LogisticsSnapshot = {
  provider: 'kdniao';
  configured: boolean;
  success: boolean;
  message?: string;
  reason?: string;
  state?: string;
  stateText?: string;
  shipperCode?: string;
  shipperName?: string;
  trackingNo: string;
  traces: Array<{
    time: string;
    text: string;
    location?: string;
  }>;
  queriedAt: string;
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    @InjectRepository(OrderAfterSale)
    private afterSaleRepository: Repository<OrderAfterSale>,
    @Inject(forwardRef(() => DistributorService))
    private distributorService: DistributorService,
    private xpayService: XpayService,
    private referralCouponService: ReferralCouponService,
    private packageService: PackageService,
    private coinService: CoinService,
    private configService: ConfigService,
  ) {}

  /**
   * 创建预支付订单
   */
  async createOrder(userId: number, dto: CreateOrderDto, clientIp?: string) {
    const orderType = dto.order_type || 'course';
    if (orderType === 'package') {
      return this.createPackageOrder(userId, dto, clientIp);
    }
    return this.createCourseOrder(userId, dto, clientIp);
  }

  async createCartOrder(userId: number, dto: CreateCartOrderDto, clientIp?: string) {
    const courseIds = [...new Set((dto.course_ids || []).map((id) => Number(id)).filter((id) => id > 0))];
    if (courseIds.length === 0) {
      throw new BadRequestException('请选择要购买的课程');
    }
    if (courseIds.length > 20) {
      throw new BadRequestException('单次最多购买20门课程');
    }

    const courses = await this.courseRepository.find({ where: { id: In(courseIds) } });
    const courseMap = new Map(courses.map((course) => [course.id, course]));
    if (courses.length !== courseIds.length) {
      throw new NotFoundException('部分课程不存在或已下架');
    }

    const shippingAddress = this.resolveShippingAddressForCourses(courses, dto.shipping_address);
    const cartItems: Array<{ course_id: number; name: string; price: number; content_type: string }> = [];
    let originalAmount = 0;

    for (const courseId of courseIds) {
      const course = courseMap.get(courseId);
      if (!course) {
        continue;
      }
      if (course.is_free === 1) {
        throw new BadRequestException(`《${course.name}》为免费课程，无需加入购物车`);
      }
      const price = Number(course.price || 0);
      assertIntegerYuanPrice(price, `《${course.name}》价格`);

      const existingAuth = await this.userCourseAuthRepository.findOne({
        where: { user_id: userId, course_id: courseId },
      });
      if (existingAuth) {
        throw new BadRequestException(`您已拥有《${course.name}》`);
      }

      const hasPackageAccess = await this.packageService.userHasCourseAccessViaPackage(userId, course);
      if (hasPackageAccess) {
        throw new BadRequestException(`套餐已包含《${course.name}》`);
      }

      cartItems.push({
        course_id: course.id,
        name: course.name || '课程',
        price,
        content_type: course.content_type || 'normal',
      });
      originalAmount += price;
    }

    let discountAmount = 0;
    let couponId: number | null = null;
    if (dto.coupon_id && originalAmount > 0) {
      const couponResult = await this.referralCouponService.validateCouponForOrder(
        userId,
        dto.coupon_id,
        originalAmount,
      );
      discountAmount = couponResult.discount;
      couponId = couponResult.coupon.id;
    }

    const amount = normalizePayAmountYuan(Math.max(0, originalAmount - discountAmount));
    const goodsTitle = cartItems.length > 1 ? `购物车(${cartItems.length}门课程)` : cartItems[0].name;

    if (amount <= 0) {
      const freeOrder = this.orderRepository.create({
        order_no: this.generateOrderNo(),
        user_id: userId,
        course_id: cartItems[0].course_id,
        order_type: 'course',
        amount: 0,
        original_amount: originalAmount,
        discount_amount: discountAmount,
        coupon_id: couponId,
        status: OrderStatus.PENDING,
        pay_provider: 'free',
        shipping_address: shippingAddress,
        pay_payload: {
          is_cart: true,
          cart_items: cartItems,
        },
      });
      await this.orderRepository.save(freeOrder);
      await this.handlePaymentSuccess(freeOrder.id);
      return {
        order_no: freeOrder.order_no,
        amount: freeOrder.amount,
        order_type: 'course',
        course_ids: cartItems.map((item) => item.course_id),
        status: OrderStatus.PAID,
        payment_params: null,
      };
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const order = this.orderRepository.create({
      order_no: this.generateOrderNo(),
      user_id: userId,
      course_id: cartItems[0].course_id,
      order_type: 'course',
      amount,
      original_amount: originalAmount,
      discount_amount: discountAmount,
      coupon_id: couponId,
      status: OrderStatus.PENDING,
      pay_provider: 'virtual_payment',
      shipping_address: shippingAddress,
      pay_payload: {
        is_cart: true,
        cart_items: cartItems,
      },
    });
    await this.orderRepository.save(order);

    return this.processCoinBasedPayment({
      user,
      userId,
      order,
      payAmountYuan: amount,
      goodsTitle,
      clientIp,
      responseExtras: {
        order_type: order.order_type,
        course_ids: cartItems.map((item) => item.course_id),
        is_cart: true,
      },
    });
  }

  private async createCourseOrder(userId: number, dto: CreateOrderDto, clientIp?: string) {
    if (!dto.course_id) {
      throw new BadRequestException('课程ID不能为空');
    }

    const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const shippingAddress = this.resolveShippingAddressForCourses([course], dto.shipping_address);

    const originalAmount = Number(course.price || 0);
    if (course.is_free !== 1 && originalAmount > 0) {
      assertIntegerYuanPrice(originalAmount, '课程价格');
    }
    let discountAmount = 0;
    let couponId: number | null = null;

    if (dto.coupon_id && originalAmount > 0) {
      const couponResult = await this.referralCouponService.validateCouponForOrder(userId, dto.coupon_id, originalAmount);
      discountAmount = couponResult.discount;
      couponId = couponResult.coupon.id;
    }

    const amount = normalizePayAmountYuan(Math.max(0, originalAmount - discountAmount));

    if (amount <= 0 || course.is_free === 1) {
      const freeOrder = this.orderRepository.create({
        order_no: this.generateOrderNo(),
        user_id: userId,
        course_id: dto.course_id,
        order_type: 'course',
        amount: 0,
        original_amount: originalAmount,
        discount_amount: discountAmount,
        coupon_id: couponId,
        status: OrderStatus.PENDING,
        pay_provider: 'free',
        shipping_address: shippingAddress,
      });
      await this.orderRepository.save(freeOrder);
      await this.handlePaymentSuccess(freeOrder.id);

      return {
        order_no: freeOrder.order_no,
        amount: freeOrder.amount,
        course_id: freeOrder.course_id,
        order_type: 'course',
        status: OrderStatus.PAID,
        payment_params: null,
      };
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const orderNo = this.generateOrderNo();
    const order = this.orderRepository.create({
      order_no: orderNo,
      user_id: userId,
      course_id: dto.course_id,
      order_type: 'course',
      amount,
      original_amount: originalAmount,
      discount_amount: discountAmount,
      coupon_id: couponId,
      status: OrderStatus.PENDING,
      pay_provider: 'virtual_payment',
      shipping_address: shippingAddress,
    });

    await this.orderRepository.save(order);

    return this.processCoinBasedPayment({
      user,
      userId,
      order,
      payAmountYuan: amount,
      goodsTitle: course.name || '课程',
      clientIp,
      responseExtras: {
        course_id: order.course_id,
        order_type: order.order_type,
      },
    });
  }

  private async grantCourseAccess(userId: number, courseId: number) {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
    });
    if (!course) {
      return;
    }

    let expireTime: Date | null = null;
    if (course.validity_days !== null && course.validity_days !== undefined) {
      expireTime = new Date();
      expireTime.setDate(expireTime.getDate() + course.validity_days);
    }

    const existingAuth = await this.userCourseAuthRepository.findOne({
      where: {
        user_id: userId,
        course_id: courseId,
      },
    });

    if (!existingAuth) {
      await this.userCourseAuthRepository.save({
        user_id: userId,
        course_id: courseId,
        source: AuthSource.PURCHASE,
        expire_time: expireTime,
      });
      return;
    }

    if (!existingAuth.expire_time || (expireTime && expireTime > existingAuth.expire_time)) {
      existingAuth.expire_time = expireTime;
      await this.userCourseAuthRepository.save(existingAuth);
    }
  }

  private resolveShippingAddressForCourses(
    courses: Array<Pick<Course, 'content_type' | 'name'>>,
    input?: Record<string, any>,
  ): OrderShippingAddress | null {
    const hasPaperExamCourse = courses.some((course) => course.content_type === 'paper_exam');
    if (!hasPaperExamCourse) {
      return input ? this.normalizeShippingAddress(input, false) : null;
    }
    return this.normalizeShippingAddress(input, true);
  }

  private normalizeShippingAddress(input: Record<string, any> | undefined, required: boolean): OrderShippingAddress | null {
    if (!input || typeof input !== 'object') {
      if (required) {
        throw new BadRequestException('纸质专业真题需要填写收货地址');
      }
      return null;
    }

    const normalized: OrderShippingAddress = {
      name: this.pickString(input, ['name', 'userName', 'receiverName', 'contactName']),
      phone: this.pickString(input, ['phone', 'telNumber', 'mobile', 'contactPhone']),
      province: this.pickString(input, ['province', 'provinceName']),
      city: this.pickString(input, ['city', 'cityName']),
      district: this.pickString(input, ['district', 'countyName', 'area']),
      detail: this.pickString(input, ['detail', 'detailInfo', 'addressDetail']),
      postalCode: this.pickString(input, ['postalCode', 'postCode']),
      nationalCode: this.pickString(input, ['nationalCode']),
      raw: input,
    };

    if (required) {
      const missing = [
        ['name', normalized.name],
        ['phone', normalized.phone],
        ['province', normalized.province],
        ['city', normalized.city],
        ['district', normalized.district],
        ['detail', normalized.detail],
      ].filter(([, value]) => !value);
      if (missing.length > 0) {
        throw new BadRequestException('收货地址不完整，请重新选择微信收货地址');
      }
    }

    if (!normalized.name && !normalized.phone && !normalized.detail) {
      return null;
    }
    return normalized;
  }

  private pickString(input: Record<string, any>, keys: string[]) {
    for (const key of keys) {
      const value = input[key];
      if (value !== undefined && value !== null) {
        const text = String(value).trim();
        if (text) return text;
      }
    }
    return '';
  }

  private async createPackageOrder(userId: number, dto: CreateOrderDto, clientIp?: string) {
    if (!dto.package_section_id || !dto.package_plan_id) {
      throw new BadRequestException('套餐信息不能为空');
    }

    const plan = await this.packageService.getPlanForOrder(dto.package_section_id, dto.package_plan_id);
    const originalAmount = Number(plan.price || 0);
    if (originalAmount > 0) {
      assertIntegerYuanPrice(originalAmount, '套餐价格');
    }
    let discountAmount = 0;
    let couponId: number | null = null;

    if (dto.coupon_id && originalAmount > 0) {
      const couponResult = await this.referralCouponService.validateCouponForOrder(userId, dto.coupon_id, originalAmount);
      discountAmount = couponResult.discount;
      couponId = couponResult.coupon.id;
    }

    const amount = normalizePayAmountYuan(Math.max(0, originalAmount - discountAmount));

    if (amount <= 0) {
      const freeOrder = this.orderRepository.create({
        order_no: this.generateOrderNo(),
        user_id: userId,
        course_id: null,
        order_type: 'package',
        package_section_id: dto.package_section_id,
        package_plan_id: dto.package_plan_id,
        amount: 0,
        original_amount: originalAmount,
        discount_amount: discountAmount,
        coupon_id: couponId,
        status: OrderStatus.PENDING,
        pay_provider: 'free',
      });
      await this.orderRepository.save(freeOrder);
      await this.handlePaymentSuccess(freeOrder.id);
      return {
        order_no: freeOrder.order_no,
        amount: freeOrder.amount,
        order_type: 'package',
        package_section_id: freeOrder.package_section_id,
        package_plan_id: freeOrder.package_plan_id,
        status: OrderStatus.PAID,
        payment_params: null,
      };
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const order = this.orderRepository.create({
      order_no: this.generateOrderNo(),
      user_id: userId,
      course_id: null,
      order_type: 'package',
      package_section_id: dto.package_section_id,
      package_plan_id: dto.package_plan_id,
      amount,
      original_amount: originalAmount,
      discount_amount: discountAmount,
      coupon_id: couponId,
      status: OrderStatus.PENDING,
      pay_provider: 'virtual_payment',
    });
    await this.orderRepository.save(order);

    return this.processCoinBasedPayment({
      user,
      userId,
      order,
      payAmountYuan: amount,
      goodsTitle: `${plan.section.name}-${plan.name}`,
      clientIp,
      responseExtras: {
        order_type: order.order_type,
        package_section_id: order.package_section_id,
        package_plan_id: order.package_plan_id,
      },
    });
  }

  /**
   * 官方代币购课：query_user_balance → 不足则 short_series_coin 充值 → currency_pay 扣代币 → 发货
   */
  private async processCoinBasedPayment({
    user,
    userId,
    order,
    payAmountYuan,
    goodsTitle,
    clientIp,
    responseExtras,
  }: {
    user: AppUser;
    userId: number;
    order: Order;
    payAmountYuan: number;
    goodsTitle: string;
    clientIp?: string;
    responseExtras: Record<string, unknown>;
  }) {
    const { balance, fromCache } = await this.coinService.resolveBalanceForOrder(user, clientIp);
    const coinCost = this.coinService.yuanToCoinInt(payAmountYuan);
    const coinPurchase = this.coinService.buildCoinPurchasePlan(coinCost, balance);

    if (coinPurchase.recharge_coins <= 0) {
      if (fromCache) {
        throw new BadRequestException('微信服务繁忙，暂时无法确认代币余额，请稍后重试');
      }
      const currencyPayOrderId = `${order.order_no}_COIN`;
      await this.coinService.currencyPayForOrder({
        user,
        order,
        coinAmount: coinCost,
        clientIp,
        currencyPayOrderId,
      });

      order.pay_provider = 'wechat_coin';
      order.amount = payAmountYuan;
      order.pay_payload = {
        coin_purchase: {
          ...coinPurchase,
          recharge_coins: 0,
          currency_paid: true,
          currency_pay_order_id: currencyPayOrderId,
        },
      };
      await this.orderRepository.save(order);
      await this.handlePaymentSuccess(order.id);

      return {
        order_no: order.order_no,
        amount: order.amount,
        ...responseExtras,
        status: OrderStatus.PAID,
        payment_params: null,
      };
    }

    const existingRechargeOrderNo = String(order.pay_payload?.coin_purchase?.recharge_order_no || '');
    if (existingRechargeOrderNo) {
      const rechargeAlreadyPaid = await this.isWechatRechargePaid(user, existingRechargeOrderNo);
      if (rechargeAlreadyPaid) {
        const fulfilled = await this.tryFulfillVirtualPaymentOrder(order, user, clientIp);
        if (fulfilled.fulfilled) {
          return {
            order_no: order.order_no,
            amount: order.amount,
            ...responseExtras,
            status: OrderStatus.PAID,
            payment_params: null,
          };
        }
      }
    }

    const rechargeOrderNo = existingRechargeOrderNo || this.generateRechargeOrderNo(order.order_no);
    order.amount = payAmountYuan;
    order.pay_provider = 'virtual_payment';
    order.pay_payload = {
      coin_purchase: {
        ...coinPurchase,
        recharge_order_no: rechargeOrderNo,
      },
    };
    await this.orderRepository.save(order);

    const paymentParams = this.createCoinRechargePaymentParams({
      user,
      order,
      rechargeCoins: coinPurchase.recharge_coins,
      rechargeOrderNo,
      goodsTitle,
    });

    order.pay_payload = {
      coin_purchase: {
        ...coinPurchase,
        recharge_order_no: rechargeOrderNo,
      },
      virtual_payment: paymentParams.virtual_payment,
      payment_params: paymentParams.payment_params,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      ...responseExtras,
      status: order.status,
      payment_params: paymentParams.payment_params,
    };
  }

  private generateRechargeOrderNo(orderNo: string) {
    const suffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `${orderNo}R${suffix}`.slice(0, 32);
  }

  /** 官方 short_series_coin 充值参数（无 productId / goodsPrice） */
  private createCoinRechargePaymentParams({
    user,
    order,
    rechargeCoins,
    rechargeOrderNo,
    goodsTitle,
  }: {
    user: AppUser;
    order: Order;
    rechargeCoins: number;
    rechargeOrderNo: string;
    goodsTitle: string;
  }) {
    const config = this.xpayService.getVirtualPayConfig();
    const attach = JSON.stringify({
      type: 'coin_recharge',
      order_no: order.order_no,
      user_id: order.user_id,
      course_id: order.course_id,
      package_section_id: order.package_section_id,
      package_plan_id: order.package_plan_id,
      goods_title: goodsTitle,
    });
    const signDataObject = {
      offerId: config.offerId,
      buyQuantity: Math.max(1, Math.floor(rechargeCoins)),
      env: config.env,
      currencyType: 'CNY',
      outTradeNo: rechargeOrderNo,
      attach,
    };
    const signData = JSON.stringify(signDataObject);
    const mode = 'short_series_coin';
    const paymentParams = {
      signData,
      mode,
      paySig: this.createHmacSha256(config.appKey, `requestVirtualPayment&${signData}`),
      signature: this.createHmacSha256(user.session_key, signData),
    };

    return {
      virtual_payment: {
        signData: signDataObject,
        mode,
        env: config.env,
        offerId: config.offerId,
        buyQuantity: signDataObject.buyQuantity,
      },
      payment_params: paymentParams,
    };
  }

  /**
   * 生成订单号
   */
  private generateOrderNo(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `ORDER${timestamp}${random}`;
  }

  /**
   * 为已创建订单拉起代币支付（课程/套餐/激活码等）
   */
  async startCoinPaymentForOrder(
    userId: number,
    orderNo: string,
    clientIp?: string,
    options?: { goodsTitle?: string },
  ) {
    const order = await this.orderRepository.findOne({ where: { order_no: orderNo } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.user_id !== userId) {
      throw new ForbiddenException('无权支付该订单');
    }
    if (order.status === OrderStatus.PAID) {
      return {
        order_no: order.order_no,
        amount: order.amount,
        course_id: order.course_id,
        status: order.status,
        payment_params: null,
      };
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('当前订单不可支付');
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    let goodsTitle = options?.goodsTitle || '订单支付';
    const responseExtras: Record<string, unknown> = {
      course_id: order.course_id,
      order_type: order.order_type,
    };

    if (order.order_type === 'package') {
      const plan =
        order.package_plan_id && order.package_section_id
          ? await this.packageService.getPlanForOrder(order.package_section_id, order.package_plan_id)
          : null;
      goodsTitle = plan ? `${plan.section.name}-${plan.name}` : '套餐';
      responseExtras.package_section_id = order.package_section_id;
      responseExtras.package_plan_id = order.package_plan_id;
    } else if (order.course_id) {
      const course = await this.courseRepository.findOne({ where: { id: order.course_id } });
      if (order.pay_payload?.activation_code_purchase) {
        goodsTitle = course?.name ? `${course.name}-激活码` : '激活码';
      } else {
        goodsTitle = course?.name || '课程';
      }
    }

    return this.processCoinBasedPayment({
      user,
      userId,
      order,
      payAmountYuan: this.getOrderPayAmountYuan(order),
      goodsTitle,
      clientIp,
      responseExtras,
    });
  }

  private createHmacSha256(secret: string | undefined | null, data: string) {
    if (!secret) {
      throw new BadRequestException('微信虚拟支付签名配置缺失，请重新登录后再试');
    }
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  private getCloudPayConfig() {
    const subAppid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
    const subMchId = this.configService.get<string>('WECHAT_PAY_MCH_ID') || this.configService.get<string>('MCH_ID') || '1111726570';
    const callbackEnvId =
      this.configService.get<string>('WECHAT_PAY_CLOUDRUN_ENV_ID') ||
      this.configService.get<string>('WX_CLOUDRUN_ENV_ID') ||
      this.configService.get<string>('WX_CLOUDBASE_ENV') ||
      'prod-d1gguk4ie589126ba';
    const callbackService = this.configService.get<string>('WECHAT_PAY_CALLBACK_SERVICE') || 'prod';
    const callbackPath = this.configService.get<string>('WECHAT_PAY_CALLBACK_PATH') || '/api/app/order/pay/notify';
    const spbillCreateIp = this.configService.get<string>('WECHAT_PAY_SPBILL_CREATE_IP') || '127.0.0.1';

    if (!subAppid || !subMchId || !callbackEnvId || !callbackService || !callbackPath) {
      throw new BadRequestException('微信支付开放接口配置缺失，请检查 AppID、商户号、云托管环境、服务名和回调路径');
    }

    return {
      subAppid,
      subMchId,
      callbackEnvId,
      callbackService,
      callbackPath,
      spbillCreateIp,
    };
  }

  private async findOrderByWechatOutTradeNo(outTradeNo: string) {
    const normalized = String(outTradeNo || '').trim();
    if (!normalized) {
      return null;
    }

    const directOrder = await this.orderRepository.findOne({ where: { order_no: normalized } });
    if (directOrder) {
      return directOrder;
    }

    return this.orderRepository
      .createQueryBuilder('o')
      .where("JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.coin_purchase.recharge_order_no')) = :outTradeNo", {
        outTradeNo: normalized,
      })
      .orWhere("JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.coin_purchase.currency_pay_order_id')) = :outTradeNo", {
        outTradeNo: normalized,
      })
      .getOne();
  }

  private async isWechatRechargePaid(user: AppUser, rechargeOrderNo: string) {
    if (!rechargeOrderNo) {
      return false;
    }
    try {
      if (await this.coinService.isRechargeOrderPaid(user, rechargeOrderNo)) {
        return true;
      }
    } catch (error) {
      this.logger.warn(`查询虚拟充值单失败 ${rechargeOrderNo}: ${error?.message || error}`);
    }

    try {
      const result = await this.queryWechatPayOrder(rechargeOrderNo);
      const tradeState = result?.trade_state || result?.tradeState;
      return tradeState === 'SUCCESS';
    } catch (error) {
      this.logger.warn(`查询微信商户充值单失败 ${rechargeOrderNo}: ${error?.message || error}`);
      return false;
    }
  }

  /**
   * 充值已到账后完成代币扣减与发货；用户付完款未点确认、或后台补单时调用。
   */
  private async tryFulfillVirtualPaymentOrder(
    order: Order,
    user: AppUser,
    clientIp?: string,
    options?: { allowMissingSessionKey?: boolean; rechargeQueryAttempts?: number },
  ) {
    if (order.status === OrderStatus.PAID) {
      return { fulfilled: true, order_no: order.order_no, status: order.status };
    }
    if (order.status !== OrderStatus.PENDING) {
      return { fulfilled: false, reason: '订单状态不可完成支付' };
    }
    if (!['virtual_payment', 'wechat_coin'].includes(String(order.pay_provider || ''))) {
      return { fulfilled: false, reason: '订单支付方式不匹配' };
    }

    const coinPurchase = { ...(order.pay_payload?.coin_purchase || {}) } as Record<string, any>;
    const coinCost = Number(coinPurchase.coin_cost || this.coinService.yuanToCoinInt(Number(order.amount || 0)));

    if (Number(coinPurchase.recharge_coins || 0) > 0 && !coinPurchase.recharge_settled) {
      const rechargeOrderNo = String(coinPurchase.recharge_order_no || '');
      if (!rechargeOrderNo) {
        return { fulfilled: false, reason: '充值订单信息缺失' };
      }

      const maxAttempts = Math.max(1, options?.rechargeQueryAttempts ?? 5);
      let settled = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (await this.isWechatRechargePaid(user, rechargeOrderNo)) {
          settled = true;
          break;
        }
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      if (!settled) {
        return { fulfilled: false, reason: '微信充值尚未到账' };
      }
      coinPurchase.recharge_settled = true;
    }

    if (!coinPurchase.currency_paid) {
      const currencyPayOrderId = String(coinPurchase.currency_pay_order_id || `${order.order_no}_COIN`);
      try {
        await this.coinService.currencyPayForOrder({
          user,
          order,
          coinAmount: coinCost,
          clientIp,
          currencyPayOrderId,
          allowMissingSessionKey: options?.allowMissingSessionKey,
        });
      } catch (error) {
        if (!options?.allowMissingSessionKey || !user.session_key) {
          return {
            fulfilled: false,
            reason: error?.message || '代币扣减失败，请用户重新登录后在订单页点击继续支付',
          };
        }
        throw error;
      }
      coinPurchase.currency_paid = true;
      coinPurchase.currency_pay_order_id = currencyPayOrderId;
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
      coin_purchase: coinPurchase,
      virtual_payment_success: {
        confirmed_at: new Date().toISOString(),
        source: options?.allowMissingSessionKey ? 'admin_sync' : 'client_confirm',
      },
    };
    await this.orderRepository.save(order);
    await this.handlePaymentSuccess(order.id);

    return {
      fulfilled: true,
      order_no: order.order_no,
      status: OrderStatus.PAID,
    };
  }

  async handleWechatPayNotify(_headers: Record<string, any>, body: Record<string, any>) {
    console.log('微信支付开放接口通知:', {
      return_code: body?.returnCode || body?.return_code,
      result_code: body?.resultCode || body?.result_code,
      out_trade_no: body?.outTradeNo || body?.out_trade_no,
      total_fee: body?.totalFee || body?.total_fee,
    });

    const returnCode = body?.returnCode || body?.return_code;
    const resultCode = body?.resultCode || body?.result_code;
    if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
      return { errcode: 0 };
    }

    const orderNo = body?.outTradeNo || body?.out_trade_no;
    const totalFee = Number(body?.totalFee ?? body?.total_fee ?? 0);
    if (!orderNo || !totalFee) {
      throw new BadRequestException('支付回调参数缺失');
    }

    const order = await this.findOrderByWechatOutTradeNo(String(orderNo));
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status === OrderStatus.PAID) {
      return { errcode: 0 };
    }

    const rechargeOrderNo = String(order.pay_payload?.coin_purchase?.recharge_order_no || '');
    if (rechargeOrderNo && String(orderNo) === rechargeOrderNo) {
      const user = await this.appUserRepository.findOne({ where: { id: order.user_id } });
      if (user) {
        await this.tryFulfillVirtualPaymentOrder(order, user, undefined, {
          allowMissingSessionKey: true,
          rechargeQueryAttempts: 1,
        });
      }
      return { errcode: 0 };
    }

    const expectedFee = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    if (totalFee < expectedFee) {
      throw new BadRequestException('微信支付回调金额校验失败');
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
      wechat_pay_callback: body,
    };
    await this.orderRepository.save(order);
    await this.handlePaymentSuccess(order.id);

    return { errcode: 0 };
  }

  private generateNonceStr() {
    return crypto.randomBytes(16).toString('hex');
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async callWechatPayOpenApi(apiName: string, data: Record<string, any>) {
    const url = `http://api.weixin.qq.com/_/pay/${apiName}`;
    try {
      const response = await this.withTimeout(
        axios.post(url, data, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000,
        }),
        26000,
        `微信支付${apiName}接口超时，请稍后重试`,
      );
      const result = this.unwrapWechatPayOpenApiResponse(response.data);
      const returnCode = result?.return_code || result?.returnCode;
      const resultCode = result?.result_code || result?.resultCode;
      if ((returnCode && returnCode !== 'SUCCESS') || (resultCode && resultCode !== 'SUCCESS')) {
        this.logger.error(`微信支付开放接口 ${apiName} 返回失败`, {
          result,
          request: this.maskWechatPayRequest(data),
        });
        throw new BadRequestException(this.getWechatPayErrorMessage(result, `微信支付${apiName}接口失败`));
      }
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const responseData = error?.response?.data;
      this.logger.error(`微信支付开放接口 ${apiName} 调用失败`, {
        responseData,
        request: this.maskWechatPayRequest(data),
        error: error?.message || error,
      });
      throw new BadRequestException(
        this.getWechatPayErrorMessage(responseData, '') ||
        error?.message ||
        `微信支付${apiName}接口调用失败`,
      );
    }
  }

  private unwrapWechatPayOpenApiResponse(data: Record<string, any>) {
    if (data?.respdata) {
      return data.respdata;
    }
    if (data?.result?.respdata) {
      return data.result.respdata;
    }
    return data;
  }

  private getWechatPayErrorMessage(result: Record<string, any> | undefined, fallback: string) {
    if (!result) return fallback;
    return (
      result.err_code_des ||
      result.errCodeDes ||
      result.return_msg ||
      result.returnMsg ||
      result.err_msg ||
      result.errMsg ||
      result.message ||
      result.msg ||
      fallback
    );
  }

  private maskWechatPayRequest(data: Record<string, any>) {
    return {
      ...data,
      openid: data.openid ? `${String(data.openid).slice(0, 6)}***` : data.openid,
      sub_openid: data.sub_openid ? `${String(data.sub_openid).slice(0, 6)}***` : data.sub_openid,
    };
  }

  /**
   * 订单支付成功回调（需要对接微信支付回调时调用）
   */
  async handlePaymentSuccess(orderId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status === OrderStatus.PAID) {
      return { message: '订单已支付' };
    }

    // 更新订单状态为已支付
    order.status = OrderStatus.PAID;
    order.paid_time = new Date();
    await this.orderRepository.save(order);

    if (order.pay_payload?.activation_code_purchase) {
      return this.distributorService.fulfillActivationCodeOrder(order);
    }

    if (order.order_type === 'package') {
      await this.packageService.fulfillPackageOrder(order);
      if (order.coupon_id) {
        await this.referralCouponService.markCouponUsed(order.coupon_id, order.id);
      }
      return { message: '套餐订单支付成功' };
    }

    const cartItems = Array.isArray(order.pay_payload?.cart_items) ? order.pay_payload.cart_items : [];
    if (cartItems.length > 0) {
      for (const item of cartItems) {
        const courseId = Number(item?.course_id);
        if (courseId > 0) {
          await this.grantCourseAccess(order.user_id, courseId);
        }
      }
      if (order.coupon_id) {
        await this.referralCouponService.markCouponUsed(order.coupon_id, order.id);
      }
      try {
        await this.distributorService.processOrderCommission(orderId);
      } catch (error) {
        console.error('订单分成处理失败:', error.message);
      }
      return { message: '购物车订单支付成功' };
    }

    // 获取课程信息
    if (!order.course_id) {
      if (order.coupon_id) {
        await this.referralCouponService.markCouponUsed(order.coupon_id, order.id);
      }
      return { message: '订单支付成功' };
    }

    await this.grantCourseAccess(order.user_id, order.course_id);

    if (order.coupon_id) {
      await this.referralCouponService.markCouponUsed(order.coupon_id, order.id);
    }

    // 处理分销分成
    try {
      await this.distributorService.processOrderCommission(orderId);
    } catch (error) {
      // 分成失败不影响订单状态，只记录日志
      console.error('订单分成处理失败:', error.message);
    }

    return { message: '订单支付成功' };
  }

  async confirmWechatPayment(userId: number, orderNo: string, clientIp?: string) {
    const order = await this.orderRepository.findOne({
      where: { order_no: orderNo },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.user_id !== userId) {
      throw new ForbiddenException('无权确认该订单');
    }
    if (order.status === OrderStatus.PAID) {
      return { message: '订单已支付', order_no: order.order_no, status: order.status };
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('当前订单状态不可确认支付');
    }
    if (!['virtual_payment', 'wechat_coin'].includes(String(order.pay_provider || ''))) {
      throw new BadRequestException('订单支付方式不匹配');
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const result = await this.tryFulfillVirtualPaymentOrder(order, user, clientIp, {
      rechargeQueryAttempts: Number(this.configService.get<string>('WECHAT_COIN_RECHARGE_QUERY_ATTEMPTS') || 5),
    });
    if (!result.fulfilled) {
      throw new BadRequestException(result.reason || '充值尚未到账，请稍后再试');
    }

    return {
      message: '支付确认成功',
      order_no: order.order_no,
      status: OrderStatus.PAID,
    };
  }

  private generateRefundOrderId(orderNo: string, suffix: string) {
    return `${orderNo}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  }

  private async revokeCourseAccess(userId: number, courseId: number) {
    if (!courseId) {
      return;
    }
    await this.userCourseAuthRepository.delete({
      user_id: userId,
      course_id: courseId,
      source: AuthSource.PURCHASE,
    });
  }

  private async revokeOrderAccess(order: Order) {
    if (order.order_type === 'package') {
      await this.packageService.revokePackageOrder(order);
      return;
    }

    const cartItems = Array.isArray(order.pay_payload?.cart_items) ? order.pay_payload.cart_items : [];
    if (cartItems.length > 0) {
      for (const item of cartItems) {
        await this.revokeCourseAccess(order.user_id, Number(item?.course_id || 0));
      }
      return;
    }

    if (order.course_id) {
      await this.revokeCourseAccess(order.user_id, order.course_id);
    }
  }

  async refundOrder(orderId: number, adminId: number, dto?: RefundOrderDto) {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.pay_payload?.refund?.refunded_at) {
      throw new BadRequestException('该订单已退款');
    }
    if (order.status !== OrderStatus.AFTER_SALE) {
      throw new BadRequestException('仅售后中的订单可退款');
    }

    const user = await this.appUserRepository.findOne({ where: { id: order.user_id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const coinPurchase = { ...(order.pay_payload?.coin_purchase || {}) } as Record<string, any>;
    const coinCost = Number(coinPurchase.coin_cost || this.coinService.yuanToCoinInt(Number(order.amount || 0)));
    const refundRecords: Record<string, unknown> = {};

    if (Number(order.amount || 0) > 0) {
      if (coinPurchase.currency_paid) {
        const currencyPayOrderId = String(coinPurchase.currency_pay_order_id || `${order.order_no}_COIN`);
        const currencyRefundOrderId = this.generateRefundOrderId(order.order_no, 'COIN_RF');
        refundRecords.currency_refund = await this.coinService.cancelCurrencyPayForOrder({
          user,
          payOrderId: currencyPayOrderId,
          refundOrderId: currencyRefundOrderId,
          coinAmount: coinCost,
          allowMissingSessionKey: true,
        });
        refundRecords.currency_refund_order_id = currencyRefundOrderId;
      }

      const rechargeOrderNo = String(coinPurchase.recharge_order_no || '');
      if (rechargeOrderNo && Number(coinPurchase.recharge_coins || 0) > 0) {
        const refundFeeCents = Math.max(1, Math.round(Number(order.amount || 0) * 100));
        const cashRefundOrderId = this.generateRefundOrderId(order.order_no, 'CASH_RF');
        refundRecords.cash_refund = await this.coinService.refundCashRechargeOrder({
          user,
          rechargeOrderNo,
          refundOrderId: cashRefundOrderId,
          refundFeeCents,
          remark: dto?.remark || '售后退款',
        });
        refundRecords.cash_refund_order_id = cashRefundOrderId;
      }
    }

    await this.revokeOrderAccess(order);

    const pendingAfterSale = await this.afterSaleRepository.findOne({
      where: { order_id: order.id, status: AfterSaleStatus.PENDING },
    });
    if (pendingAfterSale) {
      pendingAfterSale.status = AfterSaleStatus.PROCESSED;
      pendingAfterSale.admin_id = adminId;
      pendingAfterSale.admin_reply = dto?.remark || '已同意退款';
      pendingAfterSale.process_time = new Date();
      await this.afterSaleRepository.save(pendingAfterSale);
    }

    order.status = OrderStatus.CANCELLED;
    order.pay_payload = {
      ...(order.pay_payload || {}),
      refund: {
        refunded_at: new Date().toISOString(),
        admin_id: adminId,
        remark: dto?.remark || '',
        ...refundRecords,
      },
    };
    await this.orderRepository.save(order);

    return {
      message: '退款成功',
      order_no: order.order_no,
      status: order.status,
    };
  }

  async syncOrderPaymentStatus(orderId: number) {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status === OrderStatus.PAID) {
      return {
        message: '订单已是已支付状态',
        order_no: order.order_no,
        status: order.status,
        synced: false,
      };
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('仅待支付订单可同步支付状态');
    }

    const user = await this.appUserRepository.findOne({ where: { id: order.user_id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const result = await this.tryFulfillVirtualPaymentOrder(order, user, undefined, {
      allowMissingSessionKey: true,
      rechargeQueryAttempts: 8,
    });
    if (!result.fulfilled) {
      throw new BadRequestException(result.reason || '暂未查询到微信支付成功记录');
    }

    return {
      message: '订单支付状态已同步',
      order_no: order.order_no,
      status: OrderStatus.PAID,
      synced: true,
    };
  }

  async shipOrder(orderId: number, dto: ShipOrderDto, actor: ShipOrderActor) {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException('仅已支付订单可发货');
    }
    if (!(await this.orderRequiresShipping(order))) {
      throw new BadRequestException('该订单不是纸质专业真题订单');
    }
    if (!order.shipping_address) {
      throw new BadRequestException('订单缺少收货地址，无法发货');
    }

    const trackingNo = String(dto.tracking_no || '').trim();
    if (!trackingNo) {
      throw new BadRequestException('请填写物流运单号');
    }

    order.delivery_status = OrderDeliveryStatus.SHIPPED;
    order.tracking_no = trackingNo;
    order.shipper_code = this.normalizeOptionalText(dto.shipper_code);
    order.shipper_name = this.normalizeOptionalText(dto.shipper_name);
    order.shipped_at = order.shipped_at || new Date();
    order.ship_operator_type = actor.operatorType;
    order.ship_operator_id = actor.operatorId || null;
    order.shipment_remark = this.normalizeOptionalText(dto.remark);

    const logisticsSnapshot = await this.queryLogisticsSnapshot({
      trackingNo,
      shipperCode: order.shipper_code || undefined,
      shipperName: order.shipper_name || undefined,
    });
    order.logistics_snapshot = logisticsSnapshot;
    if (logisticsSnapshot.shipperCode && !order.shipper_code) {
      order.shipper_code = logisticsSnapshot.shipperCode;
    }
    if (logisticsSnapshot.shipperName && !order.shipper_name) {
      order.shipper_name = logisticsSnapshot.shipperName;
    }

    await this.orderRepository.save(order);

    return {
      message: '发货信息已保存',
      orderId: order.id,
      orderNo: order.order_no,
      deliveryStatus: order.delivery_status,
      trackingNo: order.tracking_no,
      shipperCode: order.shipper_code,
      shipperName: order.shipper_name,
      shippedAt: order.shipped_at,
      logistics: logisticsSnapshot,
    };
  }

  async shipOrderByAppAdmin(appUserId: number, orderId: number, dto: ShipOrderDto) {
    await this.assertAppSuperAdmin(appUserId);
    return this.shipOrder(orderId, dto, {
      operatorType: 'app_admin',
      operatorId: appUserId,
    });
  }

  async queryOrderLogistics(orderId: number, requester?: { userId?: number; appUserId?: number; allowAdmin?: boolean }) {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (requester?.appUserId && order.user_id !== requester.appUserId) {
      const user = await this.appUserRepository.findOne({ where: { id: requester.appUserId }, select: ['id', 'role'] });
      if (!requester.allowAdmin || user?.role !== AppUserRole.ADMIN) {
        throw new ForbiddenException('无权查看该订单物流');
      }
    }

    if (!(await this.orderRequiresShipping(order))) {
      throw new BadRequestException('该订单不是纸质专业真题订单');
    }
    if (!order.tracking_no) {
      throw new BadRequestException('订单尚未录入运单号');
    }

    const logisticsSnapshot = await this.queryLogisticsSnapshot({
      trackingNo: order.tracking_no,
      shipperCode: order.shipper_code || undefined,
      shipperName: order.shipper_name || undefined,
    });
    order.logistics_snapshot = logisticsSnapshot;
    if (logisticsSnapshot.shipperCode && !order.shipper_code) {
      order.shipper_code = logisticsSnapshot.shipperCode;
    }
    if (logisticsSnapshot.shipperName && !order.shipper_name) {
      order.shipper_name = logisticsSnapshot.shipperName;
    }
    await this.orderRepository.save(order);
    return logisticsSnapshot;
  }

  /** 微信虚拟支付消息推送（xpay_coin_pay_notify 等） */
  async handleXpayNotify(body: Record<string, any>) {
    const event = body?.Event || body?.event;
    if (event === 'xpay_coin_pay_notify') {
      await this.handleXpayCoinPayNotify(body);
      return { ErrCode: 0, ErrMsg: 'success' };
    }

    await this.handleXpayRechargeNotify(body);
    return { ErrCode: 0, ErrMsg: 'success' };
  }

  private async handleXpayRechargeNotify(body: Record<string, any>) {
    const outTradeNo = String(body?.OutTradeNo || body?.out_trade_no || '').trim();
    if (!outTradeNo) {
      return;
    }

    const order = await this.findOrderByWechatOutTradeNo(outTradeNo);
    if (!order || order.status === OrderStatus.PAID) {
      return;
    }

    const rechargeOrderNo = String(order.pay_payload?.coin_purchase?.recharge_order_no || '');
    if (!rechargeOrderNo || rechargeOrderNo !== outTradeNo) {
      return;
    }

    const user = await this.appUserRepository.findOne({ where: { id: order.user_id } });
    if (!user) {
      return;
    }

    await this.tryFulfillVirtualPaymentOrder(order, user, undefined, {
      allowMissingSessionKey: true,
      rechargeQueryAttempts: 3,
    });
  }

  private async handleXpayCoinPayNotify(body: Record<string, any>) {
    const outTradeNo = String(body?.OutTradeNo || body?.out_trade_no || '').trim();
    const openId = String(body?.OpenId || body?.openid || '').trim();
    if (!outTradeNo) {
      return;
    }

    const order = await this.orderRepository
      .createQueryBuilder('o')
      .where("JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.coin_purchase.currency_pay_order_id')) = :outTradeNo", {
        outTradeNo,
      })
      .orWhere('o.order_no = :outTradeNo', { outTradeNo })
      .getOne();

    if (!order || order.status === OrderStatus.PAID) {
      return;
    }

    const user = await this.appUserRepository.findOne({ where: { id: order.user_id } });
    if (!user || (openId && user.openid !== openId)) {
      return;
    }

    const coinPurchase = { ...(order.pay_payload?.coin_purchase || {}) };
    coinPurchase.currency_paid = true;
    coinPurchase.currency_pay_order_id = outTradeNo;
    order.pay_payload = {
      ...(order.pay_payload || {}),
      coin_purchase: coinPurchase,
      xpay_coin_pay_notify: body,
    };
    await this.orderRepository.save(order);
    await this.handlePaymentSuccess(order.id);
  }

  private async queryWechatPayOrder(orderNo: string) {
    const config = this.getCloudPayConfig();
    return this.callWechatPayOpenApi('queryorder', {
      sub_mch_id: config.subMchId,
      out_trade_no: orderNo,
      nonce_str: this.generateNonceStr(),
    });
  }

  /**
   * 获取订单统计数量
   */
  async getOrderList(userId: number, status?: string) {
    const query = this.orderRepository
      .createQueryBuilder('o')
      .leftJoin(Course, 'course', 'course.id = o.course_id')
      .leftJoin('package_section', 'packageSection', 'packageSection.id = o.package_section_id')
      .where('o.user_id = :userId', { userId })
      .select([
        'o.id AS id',
        'o.order_no AS orderNo',
        'o.amount AS amount',
        'o.status AS status',
        'o.order_type AS orderType',
        'o.course_id AS courseId',
        'o.package_section_id AS packageSectionId',
        'o.package_plan_id AS packagePlanId',
        'o.discount_amount AS discountAmount',
        'o.create_time AS createTime',
        'o.paid_time AS paidTime',
        'o.pay_payload AS payPayload',
        'o.shipping_address AS shippingAddress',
        'o.delivery_status AS deliveryStatus',
        'o.tracking_no AS trackingNo',
        'o.shipper_code AS shipperCode',
        'o.shipper_name AS shipperName',
        'o.shipped_at AS shippedAt',
        'o.shipment_remark AS shipmentRemark',
        'o.logistics_snapshot AS logisticsSnapshot',
        'course.name AS courseName',
        'course.cover_img AS coverImg',
        'course.content_type AS contentType',
        'course.file_type AS fileType',
        'packageSection.name AS packageSectionName',
        'packageSection.cover_img AS packageCoverImg',
      ])
      .orderBy('o.create_time', 'DESC');

    if (status && status !== 'all') {
      const validStatuses = Object.values(OrderStatus);
      if (!validStatuses.includes(status as OrderStatus)) {
        throw new BadRequestException('订单状态参数错误');
      }
      query.andWhere('o.status = :status', { status });
    }

    const rows = await query.getRawMany();
    const orderIds = rows.map((row) => Number(row.id)).filter((id) => id > 0);
    const afterSaleMap = await this.getLatestAfterSaleMap(orderIds);

    return rows.map((row) => {
      let payPayload: Record<string, any> | null = null;
      if (row.payPayload) {
        payPayload = typeof row.payPayload === 'string' ? JSON.parse(row.payPayload) : row.payPayload;
      }
      const cartCount = Array.isArray(payPayload?.cart_items) ? payPayload.cart_items.length : 0;
      const cartItems = Array.isArray(payPayload?.cart_items)
        ? payPayload.cart_items.map((item: Record<string, any>) => ({
            courseId: Number(item.course_id || item.courseId || 0),
            name: item.name || '课程',
            price: Number(item.price || 0),
            contentType: item.content_type || item.contentType || 'normal',
          }))
        : [];
      const requiresShipping =
        row.contentType === 'paper_exam' ||
        cartItems.some((item) => item.contentType === 'paper_exam') ||
        Boolean(row.shippingAddress);
      const productName =
        cartCount > 1
          ? `购物车(${cartCount}门课程)`
          : row.orderType === 'package'
            ? row.packageSectionName || '套餐'
            : row.courseName || '课程';

      return {
        id: Number(row.id),
        orderNo: row.orderNo,
        amount: Number(row.amount || 0),
        discountAmount: Number(row.discountAmount || 0),
        status: row.status,
        orderType: row.orderType || 'course',
        courseId: row.courseId ? Number(row.courseId) : null,
        packageSectionId: row.packageSectionId ? Number(row.packageSectionId) : null,
        packagePlanId: row.packagePlanId ? Number(row.packagePlanId) : null,
        productName,
        coverImg: row.orderType === 'package' ? row.packageCoverImg || '' : row.coverImg || '',
        contentType: row.contentType || 'normal',
        fileType: row.fileType || '',
        createTime: row.createTime,
        paidTime: row.paidTime,
        isCart: cartCount > 1,
        cartCount,
        cartItems,
        shippingAddress: this.parseJsonColumn(row.shippingAddress),
        requiresShipping,
        deliveryStatus: row.deliveryStatus || OrderDeliveryStatus.PENDING,
        trackingNo: row.trackingNo || '',
        shipperCode: row.shipperCode || '',
        shipperName: row.shipperName || '',
        shippedAt: row.shippedAt || null,
        shipmentRemark: row.shipmentRemark || '',
        logisticsSnapshot: this.parseJsonColumn(row.logisticsSnapshot),
        afterSale: this.formatAfterSaleInfo(afterSaleMap.get(Number(row.id))),
      };
    });
  }

  async payPendingOrder(userId: number, orderId: number, clientIp?: string) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.user_id !== userId) {
      throw new ForbiddenException('无权支付该订单');
    }
    if (order.status === OrderStatus.PAID) {
      return {
        order_no: order.order_no,
        amount: order.amount,
        course_id: order.course_id,
        status: order.status,
        payment_params: null,
      };
    }
    if (order.status !== OrderStatus.PENDING || order.pay_provider !== 'virtual_payment') {
      throw new BadRequestException('当前订单不可继续支付');
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const fulfilled = await this.tryFulfillVirtualPaymentOrder(order, user, clientIp);
    if (fulfilled.fulfilled) {
      return {
        order_no: order.order_no,
        amount: order.amount,
        course_id: order.course_id,
        status: OrderStatus.PAID,
        payment_params: null,
      };
    }

    const existingPaymentParams = order.pay_payload?.payment_params;
    if (existingPaymentParams) {
      return {
        order_no: order.order_no,
        amount: order.amount,
        course_id: order.course_id,
        order_type: order.order_type,
        status: order.status,
        payment_params: existingPaymentParams,
      };
    }

    if (order.order_type === 'package') {
      const plan = order.package_plan_id && order.package_section_id
        ? await this.packageService.getPlanForOrder(order.package_section_id, order.package_plan_id)
        : null;

      return this.processCoinBasedPayment({
        user,
        userId,
        order,
        payAmountYuan: this.getOrderPayAmountYuan(order),
        goodsTitle: plan ? `${plan.section.name}-${plan.name}` : '套餐',
        clientIp,
        responseExtras: {
          order_type: order.order_type,
          package_section_id: order.package_section_id,
          package_plan_id: order.package_plan_id,
        },
      });
    }

    const course = order.course_id
      ? await this.courseRepository.findOne({ where: { id: order.course_id } })
      : null;
    if (!course && !order.pay_payload?.is_cart) {
      throw new NotFoundException('课程不存在');
    }

    const activationPurchase = order.pay_payload?.activation_code_purchase;
    const cartCount = Array.isArray(order.pay_payload?.cart_items) ? order.pay_payload.cart_items.length : 0;
    const goodsTitle = order.pay_payload?.is_cart
      ? cartCount > 1
        ? `购物车(${cartCount}门课程)`
        : order.pay_payload?.cart_items?.[0]?.name || course?.name || '课程'
      : activationPurchase
        ? `${course?.name || '课程'}-激活码`
        : course?.name || '课程';

    return this.processCoinBasedPayment({
      user,
      userId,
      order,
      payAmountYuan: this.getOrderPayAmountYuan(order),
      goodsTitle,
      clientIp,
      responseExtras: {
        course_id: order.course_id,
        order_type: order.order_type,
      },
    });
  }

  private getOrderPayAmountYuan(order: Order) {
    return normalizePayAmountYuan(
      Math.max(0, Number(order.original_amount || 0) - Number(order.discount_amount || 0)),
    );
  }

  async getOrderCounts(userId: number) {
    const [pendingCount, paidCount, afterSaleCount] = await Promise.all([
      this.orderRepository.count({
        where: {
          user_id: userId,
          status: OrderStatus.PENDING,
        },
      }),
      this.orderRepository.count({
        where: {
          user_id: userId,
          status: OrderStatus.PAID,
        },
      }),
      this.orderRepository.count({
        where: {
          user_id: userId,
          status: OrderStatus.AFTER_SALE,
        },
      }),
    ]);

    return {
      pending: pendingCount,
      paid: paidCount,
      after_sale: afterSaleCount,
    };
  }

  private formatAfterSaleInfo(afterSale?: OrderAfterSale | null) {
    if (!afterSale) {
      return null;
    }
    return {
      id: afterSale.id,
      reason: afterSale.reason || '',
      description: afterSale.description || '',
      wechatContact: afterSale.wechat_contact || '',
      status: afterSale.status,
      adminReply: afterSale.admin_reply || '',
      createTime: afterSale.create_time,
      processTime: afterSale.process_time,
    };
  }

  private async getLatestAfterSaleMap(orderIds: number[]) {
    const afterSaleMap = new Map<number, OrderAfterSale>();
    if (!orderIds.length) {
      return afterSaleMap;
    }
    const afterSales = await this.afterSaleRepository.find({
      where: { order_id: In(orderIds) },
      order: { create_time: 'DESC' },
    });
    for (const afterSale of afterSales) {
      if (!afterSaleMap.has(afterSale.order_id)) {
        afterSaleMap.set(afterSale.order_id, afterSale);
      }
    }
    return afterSaleMap;
  }

  private normalizeOptionalText(value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private getCartItemsFromOrder(order: Pick<Order, 'pay_payload'>) {
    const payPayload = this.parseJsonColumn(order.pay_payload) || {};
    return Array.isArray(payPayload.cart_items) ? payPayload.cart_items : [];
  }

  private async orderRequiresShipping(order: Pick<Order, 'course_id' | 'pay_payload' | 'shipping_address'>) {
    const cartItems = this.getCartItemsFromOrder(order);
    if (cartItems.some((item: Record<string, any>) => (item.content_type || item.contentType) === 'paper_exam')) {
      return true;
    }

    const courseIds = [
      order.course_id ? Number(order.course_id) : 0,
      ...cartItems.map((item: Record<string, any>) => Number(item.course_id || item.courseId || 0)),
    ].filter((id) => id > 0);

    if (!courseIds.length) {
      return false;
    }

    const courses = await this.courseRepository.find({
      where: { id: In([...new Set(courseIds)]) },
      select: ['id', 'content_type'],
    });
    return courses.some((course) => course.content_type === 'paper_exam');
  }

  private async assertAppSuperAdmin(appUserId: number) {
    const user = await this.appUserRepository.findOne({
      where: { id: appUserId },
      select: ['id', 'role'],
    });
    if (!user || user.role !== AppUserRole.ADMIN) {
      throw new ForbiddenException('仅小程序超管可录入发货信息');
    }
    return user;
  }

  private getKdniaoConfig() {
    const businessId = String(
      this.configService.get<string>('KDNIAO_EBUSINESS_ID') ||
      this.configService.get<string>('KDNIAO_BUSINESS_ID') ||
      '',
    ).trim();
    const apiKey = String(
      this.configService.get<string>('KDNIAO_API_KEY') ||
      this.configService.get<string>('KDNIAO_APP_KEY') ||
      '',
    ).trim();

    return {
      enabled: Boolean(businessId && apiKey),
      businessId,
      apiKey,
      apiUrl:
        this.configService.get<string>('KDNIAO_API_URL') ||
        'https://api.kdniao.com/Ebusiness/EbusinessOrderHandle.aspx',
      queryRequestType: this.configService.get<string>('KDNIAO_QUERY_REQUEST_TYPE') || '1002',
      recognizeRequestType: this.configService.get<string>('KDNIAO_RECOGNIZE_REQUEST_TYPE') || '2002',
    };
  }

  private createKdniaoDataSign(requestData: string, apiKey: string) {
    return crypto.createHash('md5').update(requestData + apiKey, 'utf8').digest('base64');
  }

  private async callKdniaoApi(requestType: string, requestBody: Record<string, any>) {
    const config = this.getKdniaoConfig();
    if (!config.enabled) {
      throw new Error('快递鸟 API 未配置');
    }

    const requestData = JSON.stringify(requestBody);
    const form = new URLSearchParams();
    form.set('RequestData', requestData);
    form.set('EBusinessID', config.businessId);
    form.set('RequestType', requestType);
    form.set('DataSign', this.createKdniaoDataSign(requestData, config.apiKey));
    form.set('DataType', '2');

    const response = await axios.post(config.apiUrl, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      timeout: 10000,
    });
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }

  private async recognizeKdniaoShipper(trackingNo: string) {
    const config = this.getKdniaoConfig();
    if (!config.enabled) {
      return null;
    }

    try {
      const result = await this.callKdniaoApi(config.recognizeRequestType, {
        LogisticCode: trackingNo,
      });
      const candidates = Array.isArray(result?.Shippers)
        ? result.Shippers
        : Array.isArray(result?.shippers)
          ? result.shippers
          : [];
      const first = candidates[0] || result;
      const shipperCode = String(first?.ShipperCode || first?.shipperCode || result?.ShipperCode || '').trim();
      const shipperName = String(first?.ShipperName || first?.shipperName || result?.ShipperName || '').trim();
      if (!shipperCode && !shipperName) {
        return null;
      }
      return { shipperCode, shipperName };
    } catch (error) {
      this.logger.warn(`快递鸟单号识别失败 ${trackingNo}: ${error?.message || error}`);
      return null;
    }
  }

  private getLogisticsStateText(state?: string) {
    const map: Record<string, string> = {
      '0': '无轨迹',
      '1': '已揽收',
      '2': '在途中',
      '3': '已签收',
      '4': '问题件',
      '5': '转寄',
      '6': '清关中',
      '10': '待清关',
      '11': '清关中',
      '12': '已清关',
      '13': '清关异常',
      '14': '拒签',
    };
    return state ? map[state] || state : '';
  }

  private async queryLogisticsSnapshot(input: {
    trackingNo: string;
    shipperCode?: string;
    shipperName?: string;
  }): Promise<LogisticsSnapshot> {
    const trackingNo = String(input.trackingNo || '').trim();
    const config = this.getKdniaoConfig();
    const queriedAt = new Date().toISOString();

    if (!config.enabled) {
      return {
        provider: 'kdniao',
        configured: false,
        success: false,
        message: '快递鸟 API 未配置，已保存运单号',
        trackingNo,
        shipperCode: input.shipperCode || '',
        shipperName: input.shipperName || '',
        traces: [],
        queriedAt,
      };
    }

    try {
      const recognized = input.shipperCode
        ? null
        : await this.recognizeKdniaoShipper(trackingNo);
      const shipperCode = input.shipperCode || recognized?.shipperCode || '';
      const shipperName = input.shipperName || recognized?.shipperName || '';

      const result = await this.callKdniaoApi(config.queryRequestType, {
        OrderCode: '',
        ShipperCode: shipperCode || undefined,
        LogisticCode: trackingNo,
      });
      const traces = Array.isArray(result?.Traces)
        ? result.Traces
        : Array.isArray(result?.traces)
          ? result.traces
          : [];
      const state = String(result?.State || result?.state || '').trim();
      const success = result?.Success !== false && result?.success !== false;

      return {
        provider: 'kdniao',
        configured: true,
        success,
        message: success ? '查询成功' : '物流查询失败',
        reason: result?.Reason || result?.reason || result?.Message || result?.message || '',
        state,
        stateText: this.getLogisticsStateText(state),
        shipperCode: String(result?.ShipperCode || result?.shipperCode || shipperCode || '').trim(),
        shipperName: String(result?.ShipperName || result?.shipperName || shipperName || '').trim(),
        trackingNo: String(result?.LogisticCode || result?.logisticCode || trackingNo).trim(),
        traces: traces.map((item: Record<string, any>) => ({
          time: String(item.AcceptTime || item.acceptTime || item.time || '').trim(),
          text: String(item.AcceptStation || item.acceptStation || item.remark || item.text || '').trim(),
          location: String(item.Location || item.location || '').trim(),
        })),
        queriedAt,
      };
    } catch (error) {
      this.logger.warn(`快递鸟物流查询失败 ${trackingNo}: ${error?.message || error}`);
      return {
        provider: 'kdniao',
        configured: true,
        success: false,
        message: error?.message || '物流查询失败',
        trackingNo,
        shipperCode: input.shipperCode || '',
        shipperName: input.shipperName || '',
        traces: [],
        queriedAt,
      };
    }
  }

  async getAdminOrderDetail(orderId: number) {
    const row = await this.orderRepository
      .createQueryBuilder('o')
      .leftJoin(Course, 'course', 'course.id = o.course_id')
      .leftJoin('package_section', 'packageSection', 'packageSection.id = o.package_section_id')
      .leftJoin(AppUser, 'user', 'user.id = o.user_id')
      .where('o.id = :orderId', { orderId })
      .select([
        'o.id AS id',
        'o.order_no AS orderNo',
        'o.user_id AS userId',
        'o.amount AS amount',
        'o.original_amount AS originalAmount',
        'o.discount_amount AS discountAmount',
        'o.status AS status',
        'o.order_type AS orderType',
        'o.course_id AS courseId',
        'o.package_section_id AS packageSectionId',
        'o.package_plan_id AS packagePlanId',
        'o.coupon_id AS couponId',
        'o.pay_provider AS payProvider',
        'o.pay_payload AS payPayload',
        'o.shipping_address AS shippingAddress',
        'o.delivery_status AS deliveryStatus',
        'o.tracking_no AS trackingNo',
        'o.shipper_code AS shipperCode',
        'o.shipper_name AS shipperName',
        'o.shipped_at AS shippedAt',
        'o.ship_operator_type AS shipOperatorType',
        'o.ship_operator_id AS shipOperatorId',
        'o.shipment_remark AS shipmentRemark',
        'o.logistics_snapshot AS logisticsSnapshot',
        'o.create_time AS createTime',
        'o.paid_time AS paidTime',
        'course.name AS courseName',
        'course.content_type AS contentType',
        'packageSection.name AS packageSectionName',
        'user.nickname AS userNickname',
        'user.phone AS userPhone',
        'user.avatar AS userAvatar',
        'user.openid AS userOpenid',
      ])
      .getRawOne();

    if (!row) {
      throw new NotFoundException('订单不存在');
    }

    const afterSaleMap = await this.getLatestAfterSaleMap([orderId]);
    return this.mapAdminOrderRow(row, afterSaleMap.get(orderId));
  }

  private mapAdminOrderRow(row: Record<string, any>, afterSale?: OrderAfterSale) {
    let payPayload: Record<string, any> | null = null;
    if (row.payPayload) {
      payPayload = typeof row.payPayload === 'string' ? JSON.parse(row.payPayload) : row.payPayload;
    }

    const cartItems = Array.isArray(payPayload?.cart_items)
      ? payPayload.cart_items.map((item: Record<string, any>) => ({
          courseId: Number(item.course_id || item.courseId || 0),
          name: item.name || '课程',
          price: Number(item.price || 0),
          contentType: item.content_type || item.contentType || 'normal',
        }))
      : [];

    const productName =
      cartItems.length > 1
        ? `购物车(${cartItems.length}门课程)`
        : row.orderType === 'package'
          ? row.packageSectionName || '套餐'
          : row.courseName || '课程';

    return {
      id: Number(row.id),
      orderNo: row.orderNo,
      userId: Number(row.userId),
      openid: row.userOpenid || '',
      user: {
        id: Number(row.userId),
        openid: row.userOpenid || '',
        nickname: row.userNickname || '未设置',
        phone: row.userPhone || '',
        avatar: row.userAvatar || '',
      },
      amount: Number(row.amount || 0),
      originalAmount: row.originalAmount != null ? Number(row.originalAmount) : null,
      discountAmount: Number(row.discountAmount || 0),
      status: row.status,
      orderType: row.orderType || 'course',
      courseId: row.courseId ? Number(row.courseId) : null,
      courseName: row.courseName || '',
      packageSectionId: row.packageSectionId ? Number(row.packageSectionId) : null,
      packageSectionName: row.packageSectionName || '',
      packagePlanId: row.packagePlanId ? Number(row.packagePlanId) : null,
      couponId: row.couponId ? Number(row.couponId) : null,
      payProvider: row.payProvider || '',
      wechatRechargeOrderNo: payPayload?.coin_purchase?.recharge_order_no || '',
      refunded: Boolean(payPayload?.refund?.refunded_at),
      refundRemark: payPayload?.refund?.remark || '',
      shippingAddress: this.parseJsonColumn(row.shippingAddress),
      requiresShipping:
        row.contentType === 'paper_exam' ||
        cartItems.some((item) => item.contentType === 'paper_exam') ||
        Boolean(row.shippingAddress),
      deliveryStatus: row.deliveryStatus || OrderDeliveryStatus.PENDING,
      trackingNo: row.trackingNo || '',
      shipperCode: row.shipperCode || '',
      shipperName: row.shipperName || '',
      shippedAt: row.shippedAt || null,
      shipOperatorType: row.shipOperatorType || '',
      shipOperatorId: row.shipOperatorId ? Number(row.shipOperatorId) : null,
      shipmentRemark: row.shipmentRemark || '',
      logisticsSnapshot: this.parseJsonColumn(row.logisticsSnapshot),
      afterSale: this.formatAfterSaleInfo(afterSale),
      productName,
      contentType: row.contentType || 'normal',
      cartItems,
      isCart: cartItems.length > 1,
      createTime: row.createTime,
      paidTime: row.paidTime,
    };
  }

  async getAdminOrderList(dto: GetAdminOrderListDto) {
    const page = Math.max(1, Number(dto.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(dto.pageSize) || 10));
    const skip = (page - 1) * pageSize;

    const query = this.orderRepository
      .createQueryBuilder('o')
      .leftJoin(Course, 'course', 'course.id = o.course_id')
      .leftJoin('package_section', 'packageSection', 'packageSection.id = o.package_section_id')
      .leftJoin(AppUser, 'user', 'user.id = o.user_id')
      .select([
        'o.id AS id',
        'o.order_no AS orderNo',
        'o.user_id AS userId',
        'o.amount AS amount',
        'o.original_amount AS originalAmount',
        'o.discount_amount AS discountAmount',
        'o.status AS status',
        'o.order_type AS orderType',
        'o.course_id AS courseId',
        'o.package_section_id AS packageSectionId',
        'o.package_plan_id AS packagePlanId',
        'o.coupon_id AS couponId',
        'o.pay_provider AS payProvider',
        'o.pay_payload AS payPayload',
        'o.shipping_address AS shippingAddress',
        'o.delivery_status AS deliveryStatus',
        'o.tracking_no AS trackingNo',
        'o.shipper_code AS shipperCode',
        'o.shipper_name AS shipperName',
        'o.shipped_at AS shippedAt',
        'o.ship_operator_type AS shipOperatorType',
        'o.ship_operator_id AS shipOperatorId',
        'o.shipment_remark AS shipmentRemark',
        'o.logistics_snapshot AS logisticsSnapshot',
        'o.create_time AS createTime',
        'o.paid_time AS paidTime',
        'course.name AS courseName',
        'course.content_type AS contentType',
        'packageSection.name AS packageSectionName',
        'user.nickname AS userNickname',
        'user.phone AS userPhone',
        'user.avatar AS userAvatar',
        'user.openid AS userOpenid',
      ])
      .orderBy('o.create_time', 'DESC');

    if (dto.status) {
      query.andWhere('o.status = :status', { status: dto.status });
    }

    if (dto.order_type) {
      query.andWhere('o.order_type = :orderType', { orderType: dto.order_type });
    }

    const keyword = dto.keyword?.trim();
    if (keyword) {
      const userId = Number(keyword);
      if (!Number.isNaN(userId) && userId > 0) {
        query.andWhere(
          '(o.order_no LIKE :keyword OR user.nickname LIKE :keyword OR user.phone LIKE :keyword OR user.openid LIKE :keyword OR o.user_id = :userId OR JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, \'$.coin_purchase.recharge_order_no\')) LIKE :keyword)',
          { keyword: `%${keyword}%`, userId },
        );
      } else {
        query.andWhere(
          `(o.order_no LIKE :keyword OR user.nickname LIKE :keyword OR user.phone LIKE :keyword OR user.openid LIKE :keyword OR JSON_UNQUOTE(JSON_EXTRACT(o.pay_payload, '$.coin_purchase.recharge_order_no')) LIKE :keyword)`,
          {
            keyword: `%${keyword}%`,
          },
        );
      }
    }

    const total = await query.clone().getCount();
    const rows = await query.offset(skip).limit(pageSize).getRawMany();

    const orderIds = rows.map((row) => Number(row.id)).filter((id) => id > 0);
    const afterSaleMap = await this.getLatestAfterSaleMap(orderIds);

    const list = rows.map((row) => this.mapAdminOrderRow(row, afterSaleMap.get(Number(row.id))));

    return {
      list,
      total,
      page,
      pageSize,
    };
  }

  private parseJsonColumn(value: any) {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (_) {
        return null;
      }
    }
    return value;
  }
}
