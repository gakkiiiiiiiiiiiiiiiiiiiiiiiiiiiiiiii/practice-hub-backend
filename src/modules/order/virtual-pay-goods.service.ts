import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';
import axios from 'axios';
import { Course } from '../../database/entities/course.entity';
import { UploadService } from '../upload/upload.service';

export type VirtualPayConfig = {
  env: number;
  appKey: string;
  offerId: string;
  mode: string;
};

/** 微信 xpay 道具名称：长度 (0, 40]，按 UTF-8 字节计 */
const WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES = 40;
/** 微信 xpay 道具备注：按 UTF-8 字节截断 */
const WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES = 128;

@Injectable()
export class VirtualPayGoodsService {
  private readonly logger = new Logger(VirtualPayGoodsService.name);
  private readonly virtualPayGoodsReady = new Set<string>();
  private readonly virtualPayGoodsPending = new Map<string, Promise<void>>();
  private readonly virtualPayGoodsSyncedAt = new Map<string, number>();
  private wechatAccessTokenCache: { token: string; expireAt: number } | null = null;
  private wechatTlsCompatWarned = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly uploadService: UploadService,
  ) {}

  getVirtualPayConfig(): VirtualPayConfig {
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

  getVirtualPayProductId(type: 'course' | 'activation_code', courseId?: number) {
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

  buildVirtualPaySyncInfo(productId: string, config: { env: number }) {
    if (this.isVirtualPayProductPrePublished(productId)) {
      return { ready: true, wait_seconds: 0 };
    }
    const cacheKey = `${config.env}:${productId}`;
    const syncedAt = this.virtualPayGoodsSyncedAt.get(cacheKey);
    if (!syncedAt) {
      return { ready: true, wait_seconds: 0 };
    }
    const cooldownMs = this.getVirtualPayGoodsCooldownMinutes() * 60 * 1000;
    const elapsed = Date.now() - syncedAt;
    if (elapsed >= cooldownMs) {
      return { ready: true, wait_seconds: 0 };
    }
    const waitSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
    const readyAt = new Date(syncedAt + cooldownMs).toISOString();
    const waitMinutes = Math.max(1, Math.ceil(waitSeconds / 60));
    return {
      ready: false,
      wait_seconds: waitSeconds,
      ready_at: readyAt,
      message: `微信道具同步中，约 ${waitMinutes} 分钟后可支付（新建道具需等待微信侧生效）`,
    };
  }

  /**
   * 后台保存付费课程后：上传并发布 course_{id}、activation_code_{id} 道具（异步，不阻塞保存接口）
   */
  scheduleSyncCourseGoods(course: Course, options?: { force?: boolean }) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    if (course.is_free === 1 || Number(course.price) <= 0) {
      return;
    }
    void this.syncCourseGoods(course, options).catch((error) => {
      this.logger.warn(`课程 ${course.id} 虚拟支付道具同步失败: ${this.getErrorMessage(error)}`);
    });
  }

  async syncCourseGoods(course: Course, options?: { force?: boolean }) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    if (course.is_free === 1 || Number(course.price) <= 0) {
      return;
    }

    const config = this.getVirtualPayConfig();
    if (options?.force) {
      this.clearCourseGoodsCache(course.id, config.env);
    }
    const coursePriceCents = Math.max(1, Math.round(Number(course.price || 0) * 100));
    const agentPriceCents = Math.max(1, Math.round(Number(course.agent_price || course.price || 0) * 100));
    const courseName = String(course.name || `课程${course.id}`);

    await this.ensureGoodsPublished({
      config,
      productId: this.getVirtualPayProductId('course', course.id),
      name: this.buildVirtualPayGoodsName(courseName),
      price: coursePriceCents,
      remark: this.buildVirtualPayGoodsRemark('课程', courseName),
    });

    await this.ensureGoodsPublished({
      config,
      productId: this.getVirtualPayProductId('activation_code', course.id),
      name: this.buildVirtualPayGoodsName(courseName, '激活码'),
      price: agentPriceCents,
      remark: this.buildVirtualPayGoodsRemark('激活码', courseName),
    });

    this.logger.log(`课程 ${course.id} 虚拟支付道具已提交同步`);
  }

  private clearCourseGoodsCache(courseId: number, env: number) {
    for (const type of ['course', 'activation_code'] as const) {
      const productId = this.getVirtualPayProductId(type, courseId);
      this.virtualPayGoodsReady.delete(`${env}:${productId}`);
    }
  }

  private async ensureGoodsPublished({
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
    if (this.isVirtualPayProductPrePublished(productId)) {
      this.virtualPayGoodsReady.add(`${config.env}:${productId}`);
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
      .then((didSync) => {
        this.virtualPayGoodsReady.add(cacheKey);
        if (didSync) {
          this.markVirtualPayGoodsSynced(productId, config);
        }
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
  }): Promise<boolean> {
    const accessToken = await this.getWechatAccessToken();
    const itemUrl = await this.uploadService.resolveVirtualPayItemUrl();
    const item = {
      id: productId,
      name: this.truncateUtf8Bytes(name, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES),
      price: Math.max(1, Math.round(Number(price || 0))),
      remark: this.truncateUtf8Bytes(remark, WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES),
      item_url: itemUrl,
    };

    this.logger.log(`微信虚拟支付道具上传发布: ${item.id} ${item.name} ${item.price} item_url=${itemUrl}`);
    let didSync = false;
    try {
      await this.callVirtualPayApi('/xpay/start_upload_goods', { upload_item: [item] }, accessToken, config);
      await this.waitVirtualPayGoodsTask(
        '/xpay/query_upload_goods',
        'upload_item',
        'upload_status',
        item.id,
        accessToken,
        config,
      );
      didSync = true;
    } catch (error) {
      if (this.shouldSkipVirtualPayGoodsSyncError(error)) {
        this.logger.warn(`微信虚拟支付道具上传跳过: ${item.id} - ${this.getErrorMessage(error)}`);
        return false;
      }
      throw error;
    }

    try {
      await this.callVirtualPayApi('/xpay/start_publish_goods', { publish_item: [{ id: item.id }] }, accessToken, config);
      await this.waitVirtualPayGoodsTask(
        '/xpay/query_publish_goods',
        'publish_item',
        'publish_status',
        item.id,
        accessToken,
        config,
      );
      return true;
    } catch (error) {
      if (this.shouldSkipVirtualPayGoodsSyncError(error)) {
        this.logger.warn(`微信虚拟支付道具发布跳过: ${item.id} - ${this.getErrorMessage(error)}`);
        return didSync;
      }
      throw error;
    }
  }

  private getVirtualPayGoodsCooldownMinutes() {
    const minutes = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_GOODS_COOLDOWN_MINUTES') || 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
  }

  private markVirtualPayGoodsSynced(productId: string, config: { env: number }) {
    this.virtualPayGoodsSyncedAt.set(`${config.env}:${productId}`, Date.now());
  }

  private isVirtualPayProductPrePublished(productId: string) {
    const prePublished = String(this.configService.get<string>('WECHAT_VIRTUAL_PAY_PRE_PUBLISHED_IDS') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return prePublished.includes(productId) || prePublished.includes('*');
  }

  private getErrorMessage(error: any) {
    return String(error?.message || error?.response?.message || error || '');
  }

  private isVirtualPayGoodsIdempotentError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('exist') ||
      message.includes('already') ||
      message.includes('重复') ||
      message.includes('已存在') ||
      message.includes('已上传') ||
      message.includes('已发布')
    );
  }

  private isVirtualPayRateLimitError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes('频率限制') || message.includes('rate limit') || message.includes('too many requests');
  }

  private shouldSkipVirtualPayGoodsSyncError(error: any) {
    return this.isVirtualPayGoodsIdempotentError(error) || this.isVirtualPayRateLimitError(error);
  }

  private async waitVirtualPayGoodsTask(
    endpoint: string,
    listKey: 'upload_item' | 'publish_item',
    statusKey: 'upload_status' | 'publish_status',
    productId: string,
    accessToken: string,
    config: { env: number; appKey: string },
  ) {
    const maxAttempts = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_GOODS_QUERY_ATTEMPTS') || 3);
    const pollIntervalMs = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_GOODS_QUERY_INTERVAL_MS') || 2000);
    for (let i = 0; i < maxAttempts; i += 1) {
      let result: Record<string, any>;
      try {
        result = await this.callVirtualPayApi(endpoint, {}, accessToken, config);
      } catch (error) {
        if (this.shouldSkipVirtualPayGoodsSyncError(error)) {
          this.logger.warn(`微信虚拟支付查询跳过(${endpoint}): ${this.getErrorMessage(error)}`);
          return null;
        }
        throw error;
      }
      const list = Array.isArray(result?.[listKey]) ? result[listKey] : [];
      const item = list.find((entry: Record<string, any>) => String(entry.id) === String(productId));
      if (item?.errmsg) {
        const hint = String(item.errmsg).includes('图片下载')
          ? '（请确认 virtual-pay-goods-cover 为公网 HTTPS、200×200、小于 200KB）'
          : '';
        throw new BadRequestException(
          `微信虚拟支付商品${listKey === 'upload_item' ? '上传' : '发布'}失败：${item.errmsg}${hint}`,
        );
      }
      if (item && item[statusKey] !== 0) {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
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
      const errmsg = data.errmsg || `微信虚拟支付接口失败: ${data.errcode}`;
      if (this.isVirtualPayRateLimitError({ message: errmsg })) {
        throw new BadRequestException(`频率限制 ${errmsg}`);
      }
      throw new BadRequestException(errmsg);
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

  /** 微信道具名/备注按 UTF-8 字节上限截断 */
  private truncateUtf8Bytes(value: string, maxBytes: number) {
    const text = String(value || '').trim();
    if (!text || maxBytes <= 0) {
      return '';
    }
    let used = 0;
    let result = '';
    for (const char of text) {
      const size = Buffer.byteLength(char, 'utf8');
      if (used + size > maxBytes) {
        break;
      }
      used += size;
      result += char;
    }
    return result || text.slice(0, 1);
  }

  private buildVirtualPayGoodsName(courseName: string, suffix?: string) {
    const suffixText = suffix ? ` ${suffix}` : '';
    const suffixBytes = Buffer.byteLength(suffixText, 'utf8');
    const maxBaseBytes = Math.max(1, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES - suffixBytes);
    const base = this.truncateUtf8Bytes(String(courseName || '').trim(), maxBaseBytes);
    return this.truncateUtf8Bytes(`${base}${suffixText}`, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES);
  }

  private buildVirtualPayGoodsRemark(prefix: string, courseName: string) {
    const label = `${prefix}：`;
    const labelBytes = Buffer.byteLength(label, 'utf8');
    const maxNameBytes = Math.max(1, WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES - labelBytes);
    const namePart = this.truncateUtf8Bytes(String(courseName || '').trim(), maxNameBytes);
    return this.truncateUtf8Bytes(`${label}${namePart}`, WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES);
  }

  private createHmacSha256(secret: string, data: string) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
}
