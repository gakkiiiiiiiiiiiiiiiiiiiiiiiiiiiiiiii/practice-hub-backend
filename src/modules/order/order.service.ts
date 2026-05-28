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
import { VirtualPayGoodsService } from './virtual-pay-goods.service';
import { ReferralCouponService } from '../marketing/referral-coupon.service';
import { PackageService } from '../package/package.service';

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
    private virtualPayGoodsService: VirtualPayGoodsService,
    private referralCouponService: ReferralCouponService,
    private packageService: PackageService,
    private configService: ConfigService,
  ) {}

  /**
   * 创建预支付订单
   */
  async createOrder(userId: number, dto: CreateOrderDto) {
    const orderType = dto.order_type || 'course';
    if (orderType === 'package') {
      return this.createPackageOrder(userId, dto);
    }
    return this.createCourseOrder(userId, dto);
  }

  private async createCourseOrder(userId: number, dto: CreateOrderDto) {
    if (!dto.course_id) {
      throw new BadRequestException('课程ID不能为空');
    }

    const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    const originalAmount = Number(course.price || 0);
    let discountAmount = 0;
    let couponId: number | null = null;

    if (dto.coupon_id && originalAmount > 0) {
      const couponResult = await this.referralCouponService.validateCouponForOrder(userId, dto.coupon_id, originalAmount);
      discountAmount = couponResult.discount;
      couponId = couponResult.coupon.id;
    }

    const amount = Math.max(0, Number((originalAmount - discountAmount).toFixed(2)));

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
    await this.virtualPayGoodsService.prepareCourseGoodsForPayment(course);

    const paymentParams = await this.createVirtualPaymentParams({
      user,
      course,
      order,
      buyQuantity: 1,
      productId: this.virtualPayGoodsService.getVirtualPayProductId('course', course.id),
      attachType: 'course',
    });

    order.pay_payload = {
      virtual_payment: paymentParams.virtual_payment,
      payment_params: paymentParams.payment_params,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      order_type: order.order_type,
      status: order.status,
      payment_params: paymentParams.payment_params,
      virtual_pay_sync: paymentParams.virtual_pay_sync,
    };
  }

  private async createPackageOrder(userId: number, dto: CreateOrderDto) {
    if (!dto.package_section_id || !dto.package_plan_id) {
      throw new BadRequestException('套餐信息不能为空');
    }

    const plan = await this.packageService.getPlanForOrder(dto.package_section_id, dto.package_plan_id);
    const originalAmount = Number(plan.price || 0);
    let discountAmount = 0;
    let couponId: number | null = null;

    if (dto.coupon_id && originalAmount > 0) {
      const couponResult = await this.referralCouponService.validateCouponForOrder(userId, dto.coupon_id, originalAmount);
      discountAmount = couponResult.discount;
      couponId = couponResult.coupon.id;
    }

    const amount = Math.max(0, Number((originalAmount - discountAmount).toFixed(2)));

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

    await this.virtualPayGoodsService.preparePackageGoodsForPayment(plan, { payAmount: amount });

    const paymentParams = await this.createVirtualPaymentParams({
      user,
      order,
      buyQuantity: 1,
      productId: this.virtualPayGoodsService.getVirtualPayProductId('package', plan.id),
      attachType: 'package',
      goodsTitle: `${plan.section.name}-${plan.name}`,
    });

    order.pay_payload = {
      virtual_payment: paymentParams.virtual_payment,
      payment_params: paymentParams.payment_params,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      order_type: order.order_type,
      package_section_id: order.package_section_id,
      package_plan_id: order.package_plan_id,
      status: order.status,
      payment_params: paymentParams.payment_params,
      virtual_pay_sync: paymentParams.virtual_pay_sync,
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

  private async createVirtualPaymentParams({
    user,
    course,
    order,
    buyQuantity,
    productId,
    attachType = 'course',
    goodsTitle,
  }: {
    user: AppUser;
    course?: Course | null;
    order: Order;
    buyQuantity: number;
    productId: string;
    attachType?: string;
    goodsTitle?: string;
  }) {
    const config = this.virtualPayGoodsService.getVirtualPayConfig();
    const amountInCents = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const attach = JSON.stringify({
      type: attachType,
      order_no: order.order_no,
      user_id: order.user_id,
      course_id: order.course_id,
      package_section_id: order.package_section_id,
      package_plan_id: order.package_plan_id,
      goods_title: goodsTitle || course?.name || attachType,
    });
    const normalizedBuyQuantity = Math.max(1, Math.floor(Number(buyQuantity || 1)));
    const unitPriceInCents = Math.max(1, Math.round(amountInCents / normalizedBuyQuantity));
    const signDataObject = {
      offerId: config.offerId,
      buyQuantity: normalizedBuyQuantity,
      env: config.env,
      currencyType: 'CNY',
      productId,
      goodsPrice: unitPriceInCents,
      outTradeNo: order.order_no,
      attach,
    };
    const signData = JSON.stringify(signDataObject);
    const paymentParams = {
      signData,
      mode: config.mode,
      paySig: this.createHmacSha256(config.appKey, `requestVirtualPayment&${signData}`),
      signature: this.createHmacSha256(user.session_key, signData),
    };

    return {
      virtual_payment: {
        signData: signDataObject,
        mode: config.mode,
        env: config.env,
        offerId: config.offerId,
        productId,
        buyQuantity: normalizedBuyQuantity,
        goodsPrice: unitPriceInCents,
      },
      payment_params: paymentParams,
      virtual_pay_sync: this.virtualPayGoodsService.buildVirtualPaySyncInfo(productId, config),
    };
  }

  private createHmacSha256(secret: string | undefined | null, data: string) {
    if (!secret) {
      throw new BadRequestException('微信虚拟支付签名配置缺失，请重新登录后再试');
    }
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  async createVirtualPaymentParamsForExistingOrder(
    userId: number,
    orderNo: string,
    options?: { buyQuantity?: number; productId?: string; attachType?: string },
  ) {
    const [user, order] = await Promise.all([
      this.appUserRepository.findOne({ where: { id: userId } }),
      this.orderRepository.findOne({ where: { order_no: orderNo } }),
    ]);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
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
      throw new BadRequestException('当前订单不可支付');
    }

    const course = await this.courseRepository.findOne({ where: { id: order.course_id } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    await this.virtualPayGoodsService.prepareCourseGoodsForPayment(course);

    const paymentParams = await this.createVirtualPaymentParams({
      user,
      course,
      order,
      buyQuantity: options?.buyQuantity || 1,
      productId:
        options?.productId ||
        this.virtualPayGoodsService.getVirtualPayProductId(
          options?.attachType === 'activation_code' ? 'activation_code' : 'course',
          course.id,
        ),
      attachType: options?.attachType || 'course',
    });
    order.pay_payload = {
      ...(order.pay_payload || {}),
      virtual_payment: paymentParams.virtual_payment,
      payment_params: paymentParams.payment_params,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      status: order.status,
      payment_params: paymentParams.payment_params,
      virtual_pay_sync: paymentParams.virtual_pay_sync,
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
    if (order.pay_provider !== 'virtual_payment') {
      throw new BadRequestException('订单支付方式不匹配');
    }

    order.pay_payload = {
      ...(order.pay_payload || {}),
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

  async payPendingOrder(userId: number, orderId: number) {
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

    const [user, course] = await Promise.all([
      this.appUserRepository.findOne({ where: { id: userId } }),
      order.course_id ? this.courseRepository.findOne({ where: { id: order.course_id } }) : Promise.resolve(null),
    ]);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (order.order_type === 'package') {
      const plan = order.package_plan_id && order.package_section_id
        ? await this.packageService.getPlanForOrder(order.package_section_id, order.package_plan_id)
        : null;
      if (plan) {
        await this.virtualPayGoodsService.preparePackageGoodsForPayment(plan, { payAmount: order.amount });
      }
      const paymentParams = await this.createVirtualPaymentParams({
        user,
        order,
        buyQuantity: 1,
        productId: this.virtualPayGoodsService.getVirtualPayProductId('package', plan?.id),
        attachType: 'package',
        goodsTitle: plan ? `${plan.section.name}-${plan.name}` : '套餐',
      });
      order.pay_payload = {
        ...(order.pay_payload || {}),
        virtual_payment: paymentParams.virtual_payment,
        payment_params: paymentParams.payment_params,
      };
      await this.orderRepository.save(order);
      return {
        order_no: order.order_no,
        amount: order.amount,
        order_type: order.order_type,
        status: order.status,
        payment_params: paymentParams.payment_params,
        virtual_pay_sync: paymentParams.virtual_pay_sync,
      };
    }

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    const activationPurchase = order.pay_payload?.activation_code_purchase;
    await this.virtualPayGoodsService.prepareCourseGoodsForPayment(course);

    const paymentParams = await this.createVirtualPaymentParams({
      user,
      course,
      order,
      buyQuantity: activationPurchase?.count || 1,
      productId: this.virtualPayGoodsService.getVirtualPayProductId(
        activationPurchase ? 'activation_code' : 'course',
        course.id,
      ),
      attachType: activationPurchase ? 'activation_code' : 'course',
    });
    order.pay_payload = {
      ...(order.pay_payload || {}),
      virtual_payment: paymentParams.virtual_payment,
      payment_params: paymentParams.payment_params,
    };
    await this.orderRepository.save(order);

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      status: order.status,
      payment_params: paymentParams.payment_params,
      virtual_pay_sync: paymentParams.virtual_pay_sync,
    };
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
