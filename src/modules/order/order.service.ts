import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { DistributorService } from '../distributor/distributor.service';

const cloud = require('wx-server-sdk');

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private cloudPayInitialized = false;

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
    private configService: ConfigService,
  ) {}

  /**
   * 创建预支付订单
   */
  async createOrder(userId: number, dto: CreateOrderDto) {
    const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    const amount = Number(course.price || 0);
    if (amount <= 0 || course.is_free === 1) {
      const freeOrder = this.orderRepository.create({
        order_no: this.generateOrderNo(),
        user_id: userId,
        course_id: dto.course_id,
        amount: 0,
        status: OrderStatus.PENDING,
        pay_provider: 'free',
      });
      await this.orderRepository.save(freeOrder);
      await this.handlePaymentSuccess(freeOrder.id);

      return {
        order_no: freeOrder.order_no,
        amount: freeOrder.amount,
        course_id: freeOrder.course_id,
        status: OrderStatus.PAID,
        payment_params: null,
      };
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 生成订单号
    const orderNo = this.generateOrderNo();

    // 创建订单
    const order = this.orderRepository.create({
      order_no: orderNo,
      user_id: userId,
      course_id: dto.course_id,
      amount,
      status: OrderStatus.PENDING,
      pay_provider: 'wechat_pay',
    });

    await this.orderRepository.save(order);

    const paymentParams = this.createWechatPayParams({
      user,
      course,
      order,
    });

    order.pay_payload = {
      prepay_id: paymentParams.prepay_id,
      payment_params: paymentParams.payment_params,
      cloud_payment_request: paymentParams.cloud_payment_request,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      status: order.status,
      payment_params: paymentParams.payment_params,
      cloud_payment_request: paymentParams.cloud_payment_request,
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

  private createWechatPayParams({
    user,
    course,
    order,
  }: {
    user: AppUser;
    course: Course;
    order: Order;
  }) {
    const config = this.getCloudPayConfig();

    const amountInCents = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const attach = JSON.stringify({
      order_no: order.order_no,
      user_id: order.user_id,
      course_id: order.course_id,
    });
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const cloudPaymentRequest = {
      body: course.name.slice(0, 127),
      outTradeNo: order.order_no,
      spbillCreateIp: config.spbillCreateIp,
      subMchId: config.subMchId,
      subAppid: config.subAppid,
      subOpenid: user.openid,
      totalFee: amountInCents,
      feeType: 'CNY',
      tradeType: 'JSAPI',
      nonceStr: this.generateNonceStr(),
      attach,
      envId: config.callbackEnvId,
      functionName: config.callbackFunctionName,
      expiresAt,
    };

    return {
      prepay_id: '',
      payment_params: null,
      cloud_payment_request: {
        ...cloudPaymentRequest,
        sign: this.signPaymentPayload(cloudPaymentRequest),
      },
    };
  }

  private getCloudPayConfig() {
    const subAppid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
    const subMchId = this.configService.get<string>('WECHAT_PAY_MCH_ID') || this.configService.get<string>('MCH_ID') || '1111726570';
    const callbackEnvId =
      this.configService.get<string>('WECHAT_PAY_CALLBACK_ENV_ID') ||
      this.configService.get<string>('CBR_ENV_ID') ||
      this.configService.get<string>('TCB_ENV_ID') ||
      this.configService.get<string>('WX_CLOUDBASE_ENV') ||
      'prod-d1gguk4ie589126ba';
    const callbackFunctionName = this.configService.get<string>('WECHAT_PAY_CALLBACK_FUNCTION_NAME') || 'pay_cb';
    const spbillCreateIp = this.configService.get<string>('WECHAT_PAY_SPBILL_CREATE_IP') || '127.0.0.1';

    if (!subAppid || !subMchId || !callbackEnvId || !callbackFunctionName) {
      throw new BadRequestException('微信支付云调用配置缺失，请检查 AppID、商户号、回调云函数环境和函数名');
    }

    return {
      subAppid,
      subMchId,
      callbackEnvId,
      callbackFunctionName,
      spbillCreateIp,
    };
  }

  private initCloudPay() {
    if (this.cloudPayInitialized) return;

    cloud.init({
      env: cloud.DYNAMIC_CURRENT_ENV,
    });
    this.cloudPayInitialized = true;
  }

  async handleWechatPayNotify(headers: Record<string, any>, body: Record<string, any>) {
    this.verifyPaymentCallback(headers, body);

    console.log('微信支付云调用通知:', {
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

  private getPaymentSignSecret() {
    return (
      this.configService.get<string>('AppKey') ||
      this.configService.get<string>('WECHAT_PAY_APPKEY') ||
      this.configService.get<string>('JWT_SECRET') ||
      'default_secret'
    );
  }

  private signPaymentPayload(payload: Record<string, any>) {
    return crypto
      .createHmac('sha256', this.getPaymentSignSecret())
      .update(this.stableStringify(payload))
      .digest('base64url');
  }

  private stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(value[key])}`)
      .join(',')}}`;
  }

  private verifyPaymentProof(proof: string) {
    const [payloadBase64, signature] = String(proof || '').split('.');
    if (!payloadBase64 || !signature) {
      throw new BadRequestException('支付证明格式错误');
    }

    const expected = crypto
      .createHmac('sha256', this.getPaymentSignSecret())
      .update(payloadBase64)
      .digest('base64url');
    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new BadRequestException('支付证明签名无效');
    }

    try {
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
      if (!payload?.orderNo || !payload?.tradeState || !payload?.issuedAt) {
        throw new Error('payload invalid');
      }
      if (Date.now() - Number(payload.issuedAt) > 5 * 60 * 1000) {
        throw new BadRequestException('支付证明已过期');
      }
      return payload;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('支付证明解析失败');
    }
  }

  private verifyPaymentCallback(headers: Record<string, any>, body: Record<string, any>) {
    const timestamp = String(headers['x-pay-callback-timestamp'] || '');
    const signature = String(headers['x-pay-callback-signature'] || '');
    if (!timestamp || !signature) {
      throw new BadRequestException('支付回调签名缺失');
    }

    const age = Math.abs(Date.now() - Number(timestamp));
    if (!Number.isFinite(age) || age > 5 * 60 * 1000) {
      throw new BadRequestException('支付回调签名已过期');
    }

    const expected = crypto
      .createHmac('sha256', this.getPaymentSignSecret())
      .update(`${timestamp}.${JSON.stringify(body)}`)
      .digest('base64url');

    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new BadRequestException('支付回调签名无效');
    }
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

    // 获取课程信息
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

    // 处理分销分成
    try {
      await this.distributorService.processOrderCommission(orderId);
    } catch (error) {
      // 分成失败不影响订单状态，只记录日志
      console.error('订单分成处理失败:', error.message);
    }

    return { message: '订单支付成功' };
  }

  async confirmWechatPayment(userId: number, orderNo: string, payProof?: string) {
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
    if (order.pay_provider !== 'wechat_pay') {
      throw new BadRequestException('订单支付方式不匹配');
    }

    if (!payProof) {
      throw new BadRequestException('支付结果同步中，请稍后刷新');
    }

    const proof = this.verifyPaymentProof(payProof);
    if (proof.orderNo !== order.order_no || proof.tradeState !== 'SUCCESS') {
      throw new BadRequestException('微信支付结果未完成，请稍后重试');
    }

    const expectedFee = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const paidFee = Number(proof.totalFee || 0);
    if (paidFee < expectedFee) {
      throw new BadRequestException('微信支付金额校验失败');
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
      wechat_pay_proof: proof,
    };
    await this.orderRepository.save(order);
    await this.handlePaymentSuccess(order.id);

    return {
      message: '支付确认成功',
      order_no: order.order_no,
      status: OrderStatus.PAID,
    };
  }

  private async queryWechatPayOrder(orderNo: string) {
    const config = this.getCloudPayConfig();
    this.initCloudPay();

    return cloud.cloudPay.queryOrder({
      subMchId: config.subMchId,
      outTradeNo: orderNo,
      nonceStr: this.generateNonceStr(),
    });
  }

  /**
   * 获取订单统计数量
   */
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
