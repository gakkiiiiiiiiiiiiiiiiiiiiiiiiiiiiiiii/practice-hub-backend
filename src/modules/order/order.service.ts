import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';
import axios from 'axios';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { DistributorService } from '../distributor/distributor.service';
import { XpayService } from './xpay.service';
import { ReferralCouponService } from '../marketing/referral-coupon.service';
import { PackageService } from '../package/package.service';
import { CoinService } from './coin.service';
import { normalizePayAmountYuan, assertIntegerYuanPrice } from '../../common/utils/price.util';

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

  private async createCourseOrder(userId: number, dto: CreateOrderDto, clientIp?: string) {
    if (!dto.course_id) {
      throw new BadRequestException('课程ID不能为空');
    }

    const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

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

    const rechargeOrderNo = this.generateRechargeOrderNo(order.order_no);
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

    const order = await this.orderRepository.findOne({ where: { order_no: orderNo } });
    if (!order) {
      throw new NotFoundException('订单不存在');
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

    // 获取课程信息
    if (!order.course_id) {
      if (order.coupon_id) {
        await this.referralCouponService.markCouponUsed(order.coupon_id, order.id);
      }
      return { message: '订单支付成功' };
    }

    const course = await this.courseRepository.findOne({
      where: { id: order.course_id },
    });

    if (course) {
      // 计算过期时间
      let expireTime: Date | null = null;
      if (course.validity_days !== null && course.validity_days !== undefined) {
        // 根据课程设置的有效期天数计算过期时间
        expireTime = new Date();
        expireTime.setDate(expireTime.getDate() + course.validity_days);
      }
      // 如果 validity_days 为 null，则 expireTime 保持为 null（永久有效）

      // 检查是否已存在权限记录
      const existingAuth = await this.userCourseAuthRepository.findOne({
        where: {
          user_id: order.user_id,
          course_id: order.course_id,
        },
      });

      if (!existingAuth) {
        // 创建新的课程权限
        await this.userCourseAuthRepository.save({
          user_id: order.user_id,
          course_id: order.course_id,
          source: AuthSource.PURCHASE,
          expire_time: expireTime,
        });
      } else {
        // 如果已存在权限，更新过期时间（延长有效期）
        // 如果新过期时间晚于当前过期时间，则更新
        if (!existingAuth.expire_time || (expireTime && expireTime > existingAuth.expire_time)) {
          existingAuth.expire_time = expireTime;
          await this.userCourseAuthRepository.save(existingAuth);
        }
      }
    }

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

    const coinPurchase = { ...(order.pay_payload?.coin_purchase || {}) } as Record<string, any>;

    if (Number(coinPurchase.recharge_coins || 0) > 0 && !coinPurchase.recharge_settled) {
      const rechargeOrderNo = String(coinPurchase.recharge_order_no || '');
      if (!rechargeOrderNo) {
        throw new BadRequestException('充值订单信息缺失');
      }
      const settled = await this.coinService.waitForRechargeSettled(
        user,
        rechargeOrderNo,
        Number(coinPurchase.coin_cost || 0),
        clientIp,
      );
      if (!settled) {
        throw new BadRequestException('充值尚未到账，请稍后再试');
      }
      coinPurchase.recharge_settled = true;
    }

    if (!coinPurchase.currency_paid) {
      const currencyPayOrderId = String(coinPurchase.currency_pay_order_id || `${order.order_no}_COIN`);
      await this.coinService.currencyPayForOrder({
        user,
        order,
        coinAmount: Number(coinPurchase.coin_cost || this.coinService.yuanToCoinInt(Number(order.amount || 0))),
        clientIp,
        currencyPayOrderId,
      });
      coinPurchase.currency_paid = true;
      coinPurchase.currency_pay_order_id = currencyPayOrderId;
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
      coin_purchase: coinPurchase,
      virtual_payment_success: {
        confirmed_at: new Date().toISOString(),
      },
    };
    await this.orderRepository.save(order);
    await this.handlePaymentSuccess(order.id);

    return {
      message: '支付确认成功',
      order_no: order.order_no,
      status: OrderStatus.PAID,
    };
  }

  /** 微信虚拟支付消息推送（xpay_coin_pay_notify 等） */
  async handleXpayNotify(body: Record<string, any>) {
    const event = body?.Event || body?.event;
    if (event === 'xpay_coin_pay_notify') {
      await this.handleXpayCoinPayNotify(body);
    }
    return { ErrCode: 0, ErrMsg: 'success' };
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
    return rows.map((row) => ({
      id: Number(row.id),
      orderNo: row.orderNo,
      amount: Number(row.amount || 0),
      discountAmount: Number(row.discountAmount || 0),
      status: row.status,
      orderType: row.orderType || 'course',
      courseId: row.courseId ? Number(row.courseId) : null,
      packageSectionId: row.packageSectionId ? Number(row.packageSectionId) : null,
      packagePlanId: row.packagePlanId ? Number(row.packagePlanId) : null,
      productName: row.orderType === 'package' ? row.packageSectionName || '套餐' : row.courseName || '课程',
      coverImg: row.orderType === 'package' ? row.packageCoverImg || '' : row.coverImg || '',
      contentType: row.contentType || 'normal',
      fileType: row.fileType || '',
      createTime: row.createTime,
      paidTime: row.paidTime,
    }));
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
    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    const activationPurchase = order.pay_payload?.activation_code_purchase;
    const goodsTitle = activationPurchase ? `${course.name || '课程'}-激活码` : course.name || '课程';

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
}
