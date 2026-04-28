import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import * as https from 'https';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { DistributorService } from '../distributor/distributor.service';

@Injectable()
export class OrderService {
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

    const virtualPayConfig = this.getVirtualPayConfig();

    // 生成订单号
    const orderNo = this.generateOrderNo();

    // 创建订单
    const order = this.orderRepository.create({
      order_no: orderNo,
      user_id: userId,
      course_id: dto.course_id,
      amount,
      status: OrderStatus.PENDING,
      pay_provider: 'wechat_virtual',
    });

    await this.orderRepository.save(order);

    const paymentParams = this.createVirtualPaymentParams({
      user,
      course,
      order,
      config: virtualPayConfig,
    });

    order.pay_payload = {
      mode: paymentParams.mode,
      signData: paymentParams.signData,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      status: order.status,
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

  private getVirtualPayConfig() {
    const offerId = this.configService.get<string>('OfferID') || this.configService.get<string>('WECHAT_VIRTUAL_PAY_OFFER_ID');
    const env = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_ENV') ?? this.configService.get<string>('VIRTUAL_PAY_ENV') ?? 0);
    const appKey =
      this.configService.get<string>('AppKey') ||
      this.configService.get<string>('WECHAT_VIRTUAL_PAY_APP_KEY') ||
      this.configService.get<string>('prodAppKey') ||
      this.configService.get<string>('sandboxAppKey');

    if (!offerId || !appKey) {
      throw new BadRequestException('微信虚拟支付配置缺失，请检查 OfferID/AppKey 环境变量');
    }

    return {
      offerId,
      env,
      appKey,
      mode: this.configService.get<string>('WECHAT_VIRTUAL_PAY_MODE') || 'short_series_coin',
    };
  }

  private createVirtualPaymentParams({
    user,
    course,
    order,
    config,
  }: {
    user: AppUser;
    course: Course;
    order: Order;
    config: { offerId: string; env: number; appKey: string; mode: string };
  }) {
    if (!user.session_key) {
      throw new BadRequestException('微信登录态已过期，请重新登录后再支付');
    }

    const amountInCents = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const attach = JSON.stringify({
      order_no: order.order_no,
      user_id: order.user_id,
      course_id: order.course_id,
    });
    const signData: Record<string, any> = {
      offerId: config.offerId,
      buyQuantity: amountInCents,
      env: config.env,
      currencyType: 'CNY',
      outTradeNo: order.order_no,
      attach,
    };

    if (config.mode === 'short_series_goods') {
      signData.productId = `course_${course.id}`;
      signData.goodsPrice = amountInCents;
    }

    const signDataString = JSON.stringify(signData);

    return {
      mode: config.mode,
      signData: signDataString,
      paySig: this.createHmacSha256(config.appKey, `requestVirtualPayment&${signDataString}`),
      signature: this.createHmacSha256(user.session_key, signDataString),
    };
  }

  private createHmacSha256(key: string, payload: string) {
    return crypto.createHmac('sha256', key).update(payload).digest('hex');
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

  async confirmVirtualPayment(userId: number, orderNo: string) {
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
    if (order.pay_provider !== 'wechat_virtual') {
      throw new BadRequestException('订单支付方式不匹配');
    }

    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const wechatOrder = await this.queryWeChatVirtualOrder(user, order);
    const paidStatuses = [2, 4];
    if (!paidStatuses.includes(Number(wechatOrder.status))) {
      throw new BadRequestException('微信支付结果未完成，请稍后重试');
    }

    const expectedFee = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const paidFee = Number(wechatOrder.paid_fee ?? wechatOrder.order_fee ?? 0);
    if (paidFee < expectedFee) {
      throw new BadRequestException('微信支付金额校验失败');
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
      wechat_order: wechatOrder,
    };
    await this.orderRepository.save(order);
    await this.handlePaymentSuccess(order.id);

    return {
      message: '支付确认成功',
      order_no: order.order_no,
      status: OrderStatus.PAID,
    };
  }

  private async queryWeChatVirtualOrder(user: AppUser, order: Order) {
    const appid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
    const secret =
      this.configService.get<string>('WECHAT_SECRET') ||
      this.configService.get<string>('WECHAT_APPSECRET') ||
      this.configService.get<string>('AppSecret');
    if (!appid || !secret) {
      throw new BadRequestException('微信接口配置缺失，无法确认支付结果');
    }

    const config = this.getVirtualPayConfig();
    const accessToken = await this.getWeChatAccessToken(appid, secret);
    const payload = {
      openid: user.openid,
      order_id: order.order_no,
      env: config.env,
    };
    const bodyString = JSON.stringify(payload);
    const paySig = this.createHmacSha256(config.appKey, `/xpay/query_order&${bodyString}`);
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    const response = await axios.post(
      'https://api.weixin.qq.com/xpay/query_order',
      bodyString,
      {
        params: {
          access_token: accessToken,
          pay_sig: paySig,
        },
        headers: {
          'Content-Type': 'application/json',
        },
        httpsAgent,
      },
    );

    const data = response.data || {};
    if (data.errcode) {
      throw new BadRequestException(data.errmsg || `微信订单查询失败：${data.errcode}`);
    }
    if (!data.order) {
      throw new BadRequestException('微信订单查询结果异常');
    }

    return data.order;
  }

  private async getWeChatAccessToken(appid: string, secret: string): Promise<string> {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
    const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid,
        secret,
      },
      httpsAgent,
    });
    if (response.data?.errcode) {
      throw new BadRequestException(response.data.errmsg || `获取微信 access_token 失败：${response.data.errcode}`);
    }
    return response.data.access_token;
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
