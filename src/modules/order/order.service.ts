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

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly virtualPayGoodsReady = new Set<string>();
  private readonly virtualPayGoodsPending = new Map<string, Promise<void>>();
  private wechatAccessTokenCache: { token: string; expireAt: number } | null = null;
  private wechatTlsCompatWarned = false;

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
      pay_provider: 'virtual_payment',
    });

    await this.orderRepository.save(order);

    const paymentParams = await this.createVirtualPaymentParams({
      user,
      course,
      order,
      buyQuantity: 1,
      productId: this.getVirtualPayProductId('course', course.id),
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

  private async createVirtualPaymentParams({
    user,
    course,
    order,
    buyQuantity,
    productId,
    attachType = 'course',
  }: {
    user: AppUser;
    course: Course;
    order: Order;
    buyQuantity: number;
    productId: string;
    attachType?: string;
  }) {
    const config = this.getVirtualPayConfig();
    const amountInCents = Math.max(1, Math.round(Number(order.amount || 0) * 100));
    const attach = JSON.stringify({
      type: attachType,
      order_no: order.order_no,
      user_id: order.user_id,
      course_id: order.course_id,
    });
    const normalizedBuyQuantity = Math.max(1, Math.floor(Number(buyQuantity || 1)));
    const unitPriceInCents = Math.max(1, Math.round(amountInCents / normalizedBuyQuantity));
    await this.ensureVirtualPayGoodsPublished({
      config,
      productId,
      name: attachType === 'activation_code' ? `${course.name} 激活码` : course.name,
      price: unitPriceInCents,
      remark: attachType === 'activation_code' ? `激活码：${course.name}` : `课程：${course.name}`,
    });
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
    };
  }

  private getVirtualPayConfig() {
    const env = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_ENV') ?? 0);
    const appKey =
      (env === 1
        ? this.configService.get<string>('WECHAT_VIRTUAL_PAY_SANDBOX_APPKEY') ||
          this.configService.get<string>('SandboxAppKey')
        : this.configService.get<string>('WECHAT_VIRTUAL_PAY_APPKEY') ||
          this.configService.get<string>('ProdAppKey')) ||
      this.configService.get<string>('AppKey') ||
      this.configService.get<string>('APP_KEY');
    const offerId =
      this.configService.get<string>('WECHAT_VIRTUAL_PAY_OFFER_ID') ||
      this.configService.get<string>('OfferID') ||
      this.configService.get<string>('OFFER_ID');
    const mode = this.configService.get<string>('WECHAT_VIRTUAL_PAY_MODE') || 'short_series_goods';

    if (!appKey || !offerId) {
      throw new BadRequestException('微信虚拟支付配置缺失，请检查 AppKey 和 WECHAT_VIRTUAL_PAY_OFFER_ID');
    }

    return {
      env: Number.isFinite(env) ? env : 0,
      appKey,
      offerId,
      mode,
    };
  }

  private async ensureVirtualPayGoodsPublished({
    config,
    productId,
    name,
    price,
    remark,
  }: {
    config: { env: number; appKey: string };
    productId: string;
    name: string;
    price: number;
    remark: string;
  }) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    const cacheKey = `${config.env}:${productId}`;
    if (this.virtualPayGoodsReady.has(cacheKey)) {
      return;
    }
    const running = this.virtualPayGoodsPending.get(cacheKey);
    if (running) {
      await running;
      return;
    }

    const task = this.uploadAndPublishVirtualPayGoods({
      config,
      productId,
      name,
      price,
      remark,
    })
      .then(() => {
        this.virtualPayGoodsReady.add(cacheKey);
      })
      .finally(() => {
        this.virtualPayGoodsPending.delete(cacheKey);
      });
    this.virtualPayGoodsPending.set(cacheKey, task);
    await task;
  }

  private async uploadAndPublishVirtualPayGoods({
    config,
    productId,
    name,
    price,
    remark,
  }: {
    config: { env: number; appKey: string };
    productId: string;
    name: string;
    price: number;
    remark: string;
  }) {
    const accessToken = await this.getWechatAccessToken();
    const item = {
      id: productId,
      name: this.truncateText(name, 32),
      price: Math.max(1, Math.round(Number(price || 0))),
      remark: this.truncateText(remark, 128),
      item_url: this.getVirtualPayGoodsImageUrl(),
    };

    this.logger.log(`微信虚拟支付道具上传发布: ${item.id} ${item.name} ${item.price}`);
    try {
      await this.callVirtualPayApi('/xpay/start_upload_goods', { upload_item: [item] }, accessToken, config);
      await this.waitVirtualPayGoodsTask('/xpay/query_upload_goods', 'upload_item', 'upload_status', item.id, accessToken, config);
    } catch (error) {
      if (!this.isVirtualPayGoodsIdempotentError(error)) {
        throw error;
      }
      this.logger.warn(`微信虚拟支付道具上传已存在，继续发布: ${item.id}`);
    }

    try {
      await this.callVirtualPayApi('/xpay/start_publish_goods', { publish_item: [{ id: item.id }] }, accessToken, config);
      await this.waitVirtualPayGoodsTask('/xpay/query_publish_goods', 'publish_item', 'publish_status', item.id, accessToken, config);
    } catch (error) {
      if (!this.isVirtualPayGoodsIdempotentError(error)) {
        throw error;
      }
      this.logger.warn(`微信虚拟支付道具已发布: ${item.id}`);
    }
  }

  private isVirtualPayGoodsIdempotentError(error: any) {
    const message = String(error?.message || error?.response?.message || error || '').toLowerCase();
    return (
      message.includes('exist') ||
      message.includes('already') ||
      message.includes('重复') ||
      message.includes('已存在') ||
      message.includes('已上传') ||
      message.includes('已发布')
    );
  }

  private async waitVirtualPayGoodsTask(
    endpoint: string,
    listKey: 'upload_item' | 'publish_item',
    statusKey: 'upload_status' | 'publish_status',
    productId: string,
    accessToken: string,
    config: { env: number; appKey: string },
  ) {
    const maxAttempts = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_GOODS_QUERY_ATTEMPTS') || 6);
    for (let i = 0; i < maxAttempts; i += 1) {
      const result = await this.callVirtualPayApi(endpoint, {}, accessToken, config);
      const list = Array.isArray(result?.[listKey]) ? result[listKey] : [];
      const item = list.find((entry: Record<string, any>) => String(entry.id) === String(productId));
      if (item?.errmsg) {
        throw new BadRequestException(`微信虚拟支付商品${listKey === 'upload_item' ? '上传' : '发布'}失败：${item.errmsg}`);
      }
      if (item && item[statusKey] !== 0) {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    this.logger.warn(`微信虚拟支付商品任务查询未返回最终状态: ${endpoint} ${productId}`);
    return null;
  }

  private async callVirtualPayApi(
    endpoint: string,
    payload: Record<string, any>,
    accessToken: string,
    config: { env: number; appKey: string },
  ) {
    const body = JSON.stringify({ ...payload, env: config.env });
    const paySig = this.createHmacSha256(config.appKey, `${endpoint}&${body}`);
    const response = await this.requestWechatPublicApi(`https://api.weixin.qq.com${endpoint}`, body, {
      access_token: accessToken,
      pay_sig: paySig,
    });
    const data = response.data || {};
    if (data.errcode) {
      throw new BadRequestException(data.errmsg || `微信虚拟支付接口失败: ${data.errcode}`);
    }
    return data;
  }

  private async getWechatAccessToken() {
    const now = Date.now();
    if (this.wechatAccessTokenCache && this.wechatAccessTokenCache.expireAt > now + 60_000) {
      return this.wechatAccessTokenCache.token;
    }
    const appid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
    const secret =
      this.configService.get<string>('WECHAT_SECRET') ||
      this.configService.get<string>('AppSecret') ||
      this.configService.get<string>('WECHAT_APPSECRET');
    if (!appid || !secret) {
      throw new BadRequestException('微信虚拟支付商品上传失败：缺少 WECHAT_APPID 或 WECHAT_SECRET');
    }
    const response = await this.requestWechatPublicApi('https://api.weixin.qq.com/cgi-bin/token', null, {
      grant_type: 'client_credential',
      appid,
      secret,
    });
    const data = response.data || {};
    if (data.errcode || !data.access_token) {
      throw new BadRequestException(data.errmsg || `获取微信 access_token 失败: ${data.errcode || 'unknown'}`);
    }
    this.wechatAccessTokenCache = {
      token: data.access_token,
      expireAt: now + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000,
    };
    return data.access_token;
  }

  private async requestWechatPublicApi(url: string, body: string | null, params: Record<string, any>) {
    try {
      return body === null
        ? await axios.get(url, { params, timeout: 20000 })
        : await axios.post(url, body, {
            params,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 30000,
          });
    } catch (error) {
      if (!this.isTlsCertificateError(error)) {
        throw error;
      }
      if (!this.wechatTlsCompatWarned) {
        this.logger.warn(`微信公网接口 TLS 证书校验失败，使用兼容模式重试: ${error?.message || error}`);
        this.wechatTlsCompatWarned = true;
      }
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      return body === null
        ? axios.get(url, { params, timeout: 20000, httpsAgent })
        : axios.post(url, body, {
            params,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 30000,
            httpsAgent,
          });
    }
  }

  private isTlsCertificateError(error: any) {
    const message = String(error?.message || error?.code || '').toLowerCase();
    return (
      message.includes('self-signed certificate') ||
      message.includes('unable to verify') ||
      message.includes('certificate') ||
      error?.code === 'SELF_SIGNED_CERT_IN_CHAIN'
    );
  }

  private getVirtualPayGoodsImageUrl() {
    const configured =
      this.configService.get<string>('WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL') ||
      this.configService.get<string>('DEFAULT_COURSE_COVER_URL');
    if (configured && /^https?:\/\//i.test(configured)) {
      return configured;
    }
    const bucket = this.configService.get<string>('COS_BUCKET');
    if (bucket) {
      return `https://${bucket}.tcb.qcloud.la/images/xpay-goods-cover.jpg`;
    }
    throw new BadRequestException('微信虚拟支付商品上传失败：请配置 WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL');
  }

  private truncateText(value: string, maxLength: number) {
    const text = String(value || '').trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  private getVirtualPayProductId(type: 'course' | 'activation_code', courseId?: number) {
    const specificKey =
      type === 'activation_code'
        ? 'WECHAT_VIRTUAL_PAY_ACTIVATION_PRODUCT_ID'
        : 'WECHAT_VIRTUAL_PAY_COURSE_PRODUCT_ID';
    const productId =
      this.configService.get<string>(specificKey) ||
      this.configService.get<string>('WECHAT_VIRTUAL_PAY_PRODUCT_ID') ||
      (courseId ? `${type}_${courseId}` : '');

    if (!productId) {
      throw new BadRequestException(`微信虚拟支付商品ID缺失，请配置 ${specificKey} 或 WECHAT_VIRTUAL_PAY_PRODUCT_ID`);
    }

    return productId;
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

    const paymentParams = await this.createVirtualPaymentParams({
      user,
      course,
      order,
      buyQuantity: options?.buyQuantity || 1,
      productId:
        options?.productId ||
        this.getVirtualPayProductId(options?.attachType === 'activation_code' ? 'activation_code' : 'course', course.id),
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
      .where('o.user_id = :userId', { userId })
      .select([
        'o.id AS id',
        'o.order_no AS orderNo',
        'o.amount AS amount',
        'o.status AS status',
        'o.course_id AS courseId',
        'o.create_time AS createTime',
        'o.paid_time AS paidTime',
        'course.name AS productName',
        'course.cover_img AS coverImg',
        'course.content_type AS contentType',
        'course.file_type AS fileType',
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
      status: row.status,
      courseId: Number(row.courseId),
      productName: row.productName || '课程',
      coverImg: row.coverImg || '',
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
      this.courseRepository.findOne({ where: { id: order.course_id } }),
    ]);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    const activationPurchase = order.pay_payload?.activation_code_purchase;
    const paymentParams = await this.createVirtualPaymentParams({
      user,
      course,
      order,
      buyQuantity: activationPurchase?.count || 1,
      productId: this.getVirtualPayProductId(activationPurchase ? 'activation_code' : 'course', course.id),
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
