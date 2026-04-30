import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { DistributorService } from '../distributor/distributor.service';

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

    const paymentParams = await this.createWechatPayParams({
      user,
      course,
      order,
    });

    order.pay_payload = {
      prepay_id: paymentParams.prepay_id,
      payment_params: paymentParams.payment_params,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      status: order.status,
      payment_params: paymentParams.payment_params,
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

  private async createWechatPayParams({
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
    const requestBody = {
      openid: user.openid,
      sub_openid: user.openid,
      body: course.name.slice(0, 127),
      out_trade_no: order.order_no,
      spbill_create_ip: config.spbillCreateIp,
      sub_mch_id: config.subMchId,
      sub_appid: config.subAppid,
      total_fee: amountInCents,
      fee_type: 'CNY',
      trade_type: 'JSAPI',
      nonce_str: this.generateNonceStr(),
      attach,
      env_id: config.callbackEnvId,
      callback_type: 2,
      container: {
        service: config.callbackService,
        path: config.callbackPath,
      },
    };

    const result = await this.callWechatPayOpenApi('unifiedOrder', requestBody);
    if (!result?.payment) {
      this.logger.error('微信支付统一下单未返回 payment', {
        result,
        request: this.maskWechatPayRequest(requestBody),
      });
      throw new BadRequestException(this.getWechatPayErrorMessage(result, '微信支付统一下单失败'));
    }

    return {
      prepay_id: result.prepay_id || result.prepayId || '',
      payment_params: {
        provider: 'wxpay',
        ...result.payment,
      },
    };
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
      const result = response.data;
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

  async confirmWechatPayment(userId: number, orderNo: string) {
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

    const wechatOrder = await this.queryWechatPayOrder(order.order_no);
    const tradeState = wechatOrder.trade_state || wechatOrder.tradeState || wechatOrder.result_code || wechatOrder.resultCode;
    if (tradeState !== 'SUCCESS') {
      throw new BadRequestException('微信支付结果未完成，请稍后重试');
    }

    const expectedFee = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const paidFee = Number(
      wechatOrder.total_fee ??
      wechatOrder.totalFee ??
      wechatOrder.cash_fee ??
      wechatOrder.cashFee ??
      0,
    );
    if (paidFee < expectedFee) {
      throw new BadRequestException('微信支付金额校验失败');
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
      wechat_pay_order: wechatOrder,
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
    return this.callWechatPayOpenApi('queryorder', {
      sub_mch_id: config.subMchId,
      out_trade_no: orderNo,
      nonce_str: this.generateNonceStr(),
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
