import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import * as https from 'https';
import axios from 'axios';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { PackagePlan } from '../../database/entities/package-plan.entity';
import { UploadService } from '../upload/upload.service';

export type VirtualPayConfig = {
  env: number;
  appKey: string;
  offerId: string;
  mode: string;
};

/** 微信 xpay 道具名称：(0,40] 按 UTF-8 字节；恰好 40 字节会被拒，上限 39 */
const WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES = 39;
/** 微信 xpay 道具备注：按 UTF-8 字节截断 */
const WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES = 128;

@Injectable()
export class VirtualPayGoodsService {
  private readonly logger = new Logger(VirtualPayGoodsService.name);
  /** `${env}:${productId}` -> 已同步到微信侧的价格（分） */
  private readonly virtualPayGoodsSyncedPrice = new Map<string, number>();
  private readonly virtualPayGoodsPending = new Map<string, Promise<boolean>>();
  private readonly virtualPayGoodsSyncedAt = new Map<string, number>();
  private wechatAccessTokenCache: { token: string; expireAt: number } | null = null;
  private wechatTlsCompatWarned = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly uploadService: UploadService,
    @InjectRepository(Course)
    private readonly courseRepository: Repository<Course>,
    @InjectRepository(PackagePlan)
    private readonly packagePlanRepository: Repository<PackagePlan>,
  ) {}

  isAutoUploadEnabled() {
    return this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') !== 'false';
  }

  isScheduledSyncEnabled() {
    if (!this.isAutoUploadEnabled()) {
      return false;
    }
    return this.configService.get<string>('WECHAT_VIRTUAL_PAY_SCHEDULED_SYNC') !== 'false';
  }

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

  getVirtualPayProductId(type: 'course' | 'activation_code' | 'package' | 'coin_recharge', resourceId?: number) {
    const specificKey =
      type === 'activation_code'
        ? 'WECHAT_VIRTUAL_PAY_ACTIVATION_PRODUCT_ID'
        : type === 'package'
          ? 'WECHAT_VIRTUAL_PAY_PACKAGE_PRODUCT_ID'
          : type === 'coin_recharge'
            ? 'WECHAT_VIRTUAL_PAY_COIN_PRODUCT_ID'
            : 'WECHAT_VIRTUAL_PAY_COURSE_PRODUCT_ID';
    const productId =
      this.configService.get<string>(specificKey) ||
      this.configService.get<string>('WECHAT_VIRTUAL_PAY_PRODUCT_ID') ||
      (type === 'coin_recharge'
        ? 'coin_recharge'
        : resourceId
          ? `${type}_${resourceId}`
          : type === 'package'
            ? 'vip_default'
            : '');

    if (!productId) {
      throw new BadRequestException(`微信虚拟支付商品ID缺失，请配置 ${specificKey} 或 WECHAT_VIRTUAL_PAY_PRODUCT_ID`);
    }

    return productId;
  }

  getCoinRechargeProductId() {
    return this.getVirtualPayProductId('coin_recharge');
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

  /** 管理端改价后提示：虚拟道具价格同步中 */
  buildAdminPriceSyncNotice() {
    const waitMinutes = this.getVirtualPayGoodsCooldownMinutes();
    return {
      syncing: true,
      wait_minutes: waitMinutes,
      message: `虚拟道具价格正在同步，约 ${waitMinutes} 分钟后生效`,
    };
  }

  async countVirtualPaySyncTargets() {
    const [courses, plans] = await Promise.all([
      this.courseRepository.find(),
      this.packagePlanRepository.find({ relations: ['section'] }),
    ]);
    const courseTotal = courses.filter((course) => this.shouldSyncCourseGoods(course)).length;
    const packageTotal = plans.filter((plan) => this.shouldSyncPackagePlanGoods(plan)).length;
    return {
      courses: courseTotal,
      packages: packageTotal,
      total: courseTotal + packageTotal,
    };
  }

  /** 后台/定时任务：异步提交全量虚拟道具同步（课程 + 套餐） */
  scheduleSyncAllGoods(options?: { force?: boolean }) {
    if (!this.isAutoUploadEnabled()) {
      return;
    }
    void this.syncAllGoods({ force: options?.force ?? true })
      .then((result) => {
        this.logger.log(
          `全量虚拟道具同步完成：课程成功 ${result.courses.success}/${result.courses.total}，套餐成功 ${result.packages.success}/${result.packages.total}`,
        );
      })
      .catch((error) => {
        this.logger.warn(`全量虚拟道具同步失败: ${this.getErrorMessage(error)}`);
      });
  }

  /** 后台：异步提交全部套餐规格虚拟道具同步 */
  scheduleSyncAllPackagePlanGoods(options?: { force?: boolean }) {
    if (!this.isAutoUploadEnabled()) {
      return;
    }
    void this.syncAllPackagePlanGoods({ force: options?.force ?? true })
      .then((result) => {
        this.logger.log(`套餐虚拟道具同步完成：成功 ${result.success}/${result.total}`);
      })
      .catch((error) => {
        this.logger.warn(`套餐虚拟道具同步失败: ${this.getErrorMessage(error)}`);
      });
  }

  buildAdminBatchSyncResponse(counts: { courses: number; packages: number; total: number }) {
    return {
      ...counts,
      course_total: counts.courses,
      package_total: counts.packages,
      scheduled: true,
      virtual_pay_goods_sync: this.buildAdminPriceSyncNotice(),
    };
  }

  async syncAllGoods(options?: { force?: boolean; delayMs?: number }) {
    const courses = await this.syncAllCourseGoods(options);
    const packages = await this.syncAllPackagePlanGoods(options);
    return { courses, packages };
  }

  async syncAllCourseGoods(options?: { force?: boolean; delayMs?: number }) {
    const courses = await this.courseRepository.find();
    const targets = courses.filter((course) => this.shouldSyncCourseGoods(course));
    return this.runCourseBatchSync(targets, options);
  }

  async syncAllPackagePlanGoods(options?: { force?: boolean; delayMs?: number }) {
    const plans = await this.packagePlanRepository.find({ relations: ['section'] });
    const targets = plans.filter((plan) => this.shouldSyncPackagePlanGoods(plan));
    return this.runPackageBatchSync(targets, options);
  }

  private shouldSyncCourseGoods(course: Course) {
    return course.is_free !== 1 && Number(course.price) > 0;
  }

  private shouldSyncPackagePlanGoods(plan: PackagePlan) {
    return (plan.status ?? 1) === 1 && Number(plan.price || 0) > 0 && Boolean(plan.section);
  }

  private getBatchSyncDelayMs(options?: { delayMs?: number }) {
    if (options?.delayMs !== undefined) {
      return Math.max(0, options.delayMs);
    }
    return Math.max(0, Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_BATCH_SYNC_DELAY_MS') || 300));
  }

  private async runCourseBatchSync(courses: Course[], options?: { force?: boolean; delayMs?: number }) {
    const delayMs = this.getBatchSyncDelayMs(options);
    let success = 0;
    let failed = 0;
    for (const course of courses) {
      try {
        await this.syncCourseGoods(course, { force: options?.force ?? true });
        success += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`课程 ${course.id} 虚拟道具价格同步失败: ${this.getErrorMessage(error)}`);
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return { total: courses.length, success, failed };
  }

  private async runPackageBatchSync(plans: PackagePlan[], options?: { force?: boolean; delayMs?: number }) {
    const delayMs = this.getBatchSyncDelayMs(options);
    let success = 0;
    let failed = 0;
    for (const plan of plans) {
      try {
        await this.syncPackagePlanGoods(
          {
            sectionId: plan.section_id,
            sectionName: String(plan.section?.name || '套餐'),
            plan: { id: plan.id, name: plan.name, price: plan.price, status: plan.status },
          },
          { force: options?.force ?? true },
        );
        success += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`套餐规格 ${plan.id} 虚拟道具价格同步失败: ${this.getErrorMessage(error)}`);
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return { total: plans.length, success, failed };
  }

  /**
   * 下单/拉起支付前：套餐规格价格与微信道具 `package_{planId}` 对齐。
   */
  async preparePackageGoodsForPayment(
    plan: {
      id: number;
      name: string;
      price: number | string;
      section_id: number;
      section?: { name?: string | null };
    },
    options?: { payAmount?: number | string },
  ) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    const listPrice = Number(plan.price || 0);
    const payAmount = options?.payAmount !== undefined ? Number(options.payAmount) : listPrice;
    const effectivePrice = payAmount > 0 ? payAmount : listPrice;
    if (effectivePrice <= 0) {
      return;
    }

    const config = this.getVirtualPayConfig();
    const priceCents = Math.max(1, Math.round(effectivePrice * 100));
    const productId = this.getVirtualPayProductId('package', plan.id);
    const cacheKey = `${config.env}:${productId}`;
    const force = this.virtualPayGoodsSyncedPrice.get(cacheKey) !== priceCents;

    try {
      await this.syncPackagePlanGoods(
        {
          sectionId: plan.section_id,
          sectionName: String(plan.section?.name || '套餐'),
          plan: { id: plan.id, name: plan.name, price: effectivePrice },
        },
        { force },
      );
    } catch (error) {
      this.logger.warn(
        `下单前套餐规格 ${plan.id} 虚拟道具同步失败，继续尝试拉起支付: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 后台保存套餐规格后：上传并发布 package_{planId} 道具（异步）
   */
  scheduleSyncPackagePlanGoods(
    section: { id: number; name: string },
    plan: { id: number; name: string; price: number | string; status?: number },
    options?: { force?: boolean },
  ) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    if ((plan.status ?? 1) !== 1 || Number(plan.price || 0) <= 0) {
      return;
    }
    void this.syncPackagePlanGoods(
      {
        sectionId: section.id,
        sectionName: section.name,
        plan: { id: plan.id, name: plan.name, price: plan.price, status: plan.status },
      },
      options,
    ).catch((error) => {
      this.logger.warn(`套餐规格 ${plan.id} 虚拟支付道具同步失败: ${this.getErrorMessage(error)}`);
    });
  }

  async syncPackagePlanGoods(
    input: {
      sectionId: number;
      sectionName: string;
      plan: { id: number; name: string; price: number | string; status?: number };
    },
    options?: { force?: boolean },
  ) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    const price = Number(input.plan.price || 0);
    if ((input.plan.status ?? 1) !== 1 || price <= 0) {
      return;
    }

    const config = this.getVirtualPayConfig();
    if (options?.force) {
      this.clearPackagePlanGoodsCache(input.plan.id, config.env);
    }

    const priceCents = Math.max(1, Math.round(price * 100));
    const sectionName = String(input.sectionName || '套餐').trim();
    const planName = String(input.plan.name || '套餐').trim();
    const goodsLabel = `${sectionName}-${planName}`;

    await this.ensureGoodsPublished({
      config,
      productId: this.getVirtualPayProductId('package', input.plan.id),
      name: this.buildVirtualPayGoodsName(goodsLabel, '', input.plan.id),
      price: priceCents,
      remark: this.buildVirtualPayGoodsRemark('套餐', goodsLabel),
      force: options?.force,
    });

    this.logger.log(`套餐规格 ${input.plan.id} 虚拟支付道具已提交同步`);
  }

  private clearPackagePlanGoodsCache(planId: number, env: number) {
    const productId = this.getVirtualPayProductId('package', planId);
    const cacheKey = `${env}:${productId}`;
    this.virtualPayGoodsSyncedPrice.delete(cacheKey);
    this.virtualPayGoodsSyncedAt.delete(cacheKey);
  }

  /**
   * 下单/拉起支付前：将 course_{id} 或 activation_code_{id} 道具价与实付单价对齐。
   */
  async prepareCourseGoodsForPayment(
    course: Course,
    options?: { payAmount?: number | string; attachType?: 'course' | 'activation_code' },
  ) {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return;
    }
    if (course.is_free === 1 || Number(course.price) <= 0) {
      return;
    }

    const attachType = options?.attachType || 'course';
    const listPrice =
      attachType === 'activation_code'
        ? Number(course.agent_price || course.price || 0)
        : Number(course.price || 0);
    const payAmount = options?.payAmount !== undefined ? Number(options.payAmount) : listPrice;
    const effectivePrice = payAmount > 0 ? payAmount : listPrice;
    if (effectivePrice <= 0) {
      return;
    }

    try {
      await this.syncSingleCourseProductForPayment(course, attachType, effectivePrice);
    } catch (error) {
      this.logger.warn(
        `下单前课程 ${course.id} 虚拟道具同步失败，继续尝试拉起支付: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 代币充值：下单/拉起支付前同步 coin_recharge 道具价格为本次充值金额（元）。
   * @returns 微信侧价格是否已确认与本次充值金额一致
   */
  async prepareCoinRechargeForPayment(rechargeYuan: number): Promise<boolean> {
    if (this.configService.get<string>('WECHAT_VIRTUAL_PAY_AUTO_UPLOAD_GOODS') === 'false') {
      return true;
    }

    const amount = Number(rechargeYuan || 0);
    if (amount <= 0) {
      return true;
    }

    const config = this.getVirtualPayConfig();
    const priceCents = Math.max(1, Math.round(amount * 100));
    const productId = this.getCoinRechargeProductId();
    const cacheKey = `${config.env}:${productId}`;
    const force = this.virtualPayGoodsSyncedPrice.get(cacheKey) !== priceCents;

    try {
      return await this.ensureGoodsPublished({
        config,
        productId,
        name: this.buildVirtualPayGoodsName('学习代币', '充值', 0),
        price: priceCents,
        remark: this.buildVirtualPayGoodsRemark('代币', '充值'),
        force,
      });
    } catch (error) {
      this.logger.warn(`下单前代币充值道具同步失败: ${this.getErrorMessage(error)}`);
      return this.virtualPayGoodsSyncedPrice.get(cacheKey) === priceCents;
    }
  }

  private async syncSingleCourseProductForPayment(
    course: Course,
    productType: 'course' | 'activation_code',
    payAmount: number,
  ) {
    const config = this.getVirtualPayConfig();
    const priceCents = Math.max(1, Math.round(Number(payAmount || 0) * 100));
    const productId = this.getVirtualPayProductId(productType, course.id);
    const cacheKey = `${config.env}:${productId}`;
    const force = this.virtualPayGoodsSyncedPrice.get(cacheKey) !== priceCents;
    const courseName = String(course.name || `课程${course.id}`);
    const suffix = productType === 'activation_code' ? '激活码' : '';
    const remarkPrefix = productType === 'activation_code' ? '激活码' : '课程';

    await this.ensureGoodsPublished({
      config,
      productId,
      name: this.buildVirtualPayGoodsName(courseName, suffix, course.id),
      price: priceCents,
      remark: this.buildVirtualPayGoodsRemark(remarkPrefix, courseName),
      force,
    });
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
      name: this.buildVirtualPayGoodsName(courseName, '', course.id),
      price: coursePriceCents,
      remark: this.buildVirtualPayGoodsRemark('课程', courseName),
      force: options?.force,
    });

    await this.ensureGoodsPublished({
      config,
      productId: this.getVirtualPayProductId('activation_code', course.id),
      name: this.buildVirtualPayGoodsName(courseName, '激活码', course.id),
      price: agentPriceCents,
      remark: this.buildVirtualPayGoodsRemark('激活码', courseName),
      force: options?.force,
    });

    this.logger.log(`课程 ${course.id} 虚拟支付道具已提交同步`);
  }

  private clearCourseGoodsCache(courseId: number, env: number) {
    for (const type of ['course', 'activation_code'] as const) {
      const productId = this.getVirtualPayProductId(type, courseId);
      const cacheKey = `${env}:${productId}`;
      this.virtualPayGoodsSyncedPrice.delete(cacheKey);
      this.virtualPayGoodsSyncedAt.delete(cacheKey);
    }
  }

  private async ensureGoodsPublished({
    config,
    productId,
    name,
    price,
    remark,
    force,
  }: {
    config: { env: number; appKey: string };
    productId: string;
    name: string;
    price: number;
    remark: string;
    force?: boolean;
  }): Promise<boolean> {
    const cacheKey = `${config.env}:${productId}`;
    const normalizedPrice = Math.max(1, Math.round(Number(price || 0)));

    if (this.isVirtualPayProductPrePublished(productId) && !force) {
      return true;
    }
    if (!force && this.virtualPayGoodsSyncedPrice.get(cacheKey) === normalizedPrice) {
      return true;
    }
    const running = this.virtualPayGoodsPending.get(cacheKey);
    if (running) {
      await running;
      return this.virtualPayGoodsSyncedPrice.get(cacheKey) === normalizedPrice;
    }

    const task = this.uploadAndPublishVirtualPayGoods({
      config,
      productId,
      name,
      price: normalizedPrice,
      remark,
    })
      .then((didSync) => {
        if (didSync) {
          this.virtualPayGoodsSyncedPrice.set(cacheKey, normalizedPrice);
          this.markVirtualPayGoodsSynced(productId, config);
          return true;
        }
        const cached = this.virtualPayGoodsSyncedPrice.get(cacheKey) === normalizedPrice;
        if (force && !cached) {
          this.logger.warn(
            `微信虚拟支付道具 ${productId} 改价同步未确认成功（${normalizedPrice} 分），支付可能报 GOODS_PRICE_INVALID`,
          );
        }
        return cached;
      })
      .finally(() => {
        this.virtualPayGoodsPending.delete(cacheKey);
      });
    this.virtualPayGoodsPending.set(cacheKey, task);
    return task;
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
    const accessToken = await this.getWechatAccessTokenWithFallback();
    if (!accessToken) {
      return false;
    }
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

  private async getWechatAccessTokenWithFallback(forceRefresh = false) {
    try {
      return await this.getWechatAccessToken(forceRefresh);
    } catch (error) {
      if (this.isTransientWechatApiError(error)) {
        this.logger.warn(`获取微信 access_token 失败，跳过本次道具同步: ${this.getErrorMessage(error)}`);
        return null;
      }
      throw error;
    }
  }

  private isWeChatCloudRun() {
    return !!(
      process.env.WX_CLOUD_RUN_ENV === 'true' ||
      process.env.WX_CLOUD_ENV ||
      process.env.WX_CLOUDBASE_ENV ||
      process.env.CBR_ENV_ID ||
      this.configService.get<string>('WECHAT_PAY_CLOUDRUN_ENV_ID')
    );
  }

  private getWechatApiUrls(pathname: string) {
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    if (this.isWeChatCloudRun()) {
      return [`http://api.weixin.qq.com${normalizedPath}`, `https://api.weixin.qq.com${normalizedPath}`];
    }
    return [`https://api.weixin.qq.com${normalizedPath}`];
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

  private isTransientWechatApiError(error: any) {
    const status = Number(error?.response?.status || 0);
    const code = error?.code || error?.errno;
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      status === 502 ||
      status === 503 ||
      status === 504 ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('bad gateway') ||
      message.includes('econnreset') ||
      message.includes('timeout')
    );
  }

  private shouldSkipVirtualPayGoodsSyncError(error: any) {
    return (
      this.isVirtualPayGoodsIdempotentError(error) ||
      this.isVirtualPayRateLimitError(error) ||
      this.isTransientWechatApiError(error)
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
    retried = false,
  ) {
    const body = JSON.stringify({ ...payload, env: config.env });
    const paySig = this.createHmacSha256(config.appKey, `${endpoint}&${body}`);
    const urls = this.getWechatApiUrls(endpoint);
    let lastError: unknown;
    for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
      try {
        const response = await this.requestWechatPublicApi(urls[urlIndex], body, {
          access_token: accessToken,
          pay_sig: paySig,
        });
        const data = response.data || {};
        if (data.errcode) {
          const errmsg = data.errmsg || `微信虚拟支付接口失败: ${data.errcode}`;
          if (!retried && this.isInvalidAccessTokenError({ message: errmsg })) {
            this.logger.warn(`微信 access_token 失效，stable_token 强制刷新后重试: ${endpoint}`);
            const freshToken = await this.getWechatAccessToken(true);
            return this.callVirtualPayApi(endpoint, payload, freshToken, config, true);
          }
          if (this.isVirtualPayRateLimitError({ message: errmsg })) {
            throw new BadRequestException(`频率限制 ${errmsg}`);
          }
          throw new BadRequestException(errmsg);
        }
        return data;
      } catch (error) {
        lastError = error;
        if (urlIndex < urls.length - 1 && this.isTransientWechatApiError(error)) {
          this.logger.warn(`微信虚拟支付 ${endpoint} 调用失败，尝试备用线路: ${this.getErrorMessage(error)}`);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * 调用微信 xpay 接口（query_user_balance / currency_pay 等，可选用户态 signature）。
   */
  async callXpayApi(
    endpoint: string,
    payload: Record<string, any>,
    options?: { sessionKey?: string | null; accessToken?: string | null },
  ): Promise<Record<string, any>> {
    const config = this.getVirtualPayConfig();
    const bodyPayload = { ...payload, env: Number(payload.env ?? config.env) };
    const body = JSON.stringify(bodyPayload);
    const accessToken = options?.accessToken ?? (await this.getWechatAccessTokenWithFallback());
    if (!accessToken) {
      throw new BadRequestException('微信 access_token 获取失败，请稍后重试');
    }
    const paySig = this.createHmacSha256(config.appKey, `${endpoint}&${body}`);
    const params: Record<string, string> = {
      access_token: accessToken,
      pay_sig: paySig,
    };
    if (options?.sessionKey) {
      params.signature = this.createHmacSha256(options.sessionKey, body);
    }

    const urls = this.getWechatApiUrls(endpoint);
    let lastError: unknown;
    for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
      try {
        const response = await this.requestWechatPublicApi(urls[urlIndex], body, params);
        const data = response.data || {};
        if (data.errcode) {
          return data;
        }
        return data;
      } catch (error) {
        lastError = error;
        if (urlIndex < urls.length - 1 && this.isTransientWechatApiError(error)) {
          this.logger.warn(`xpay ${endpoint} 调用失败，尝试备用线路: ${this.getErrorMessage(error)}`);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  isXpayDuplicateSuccess(errcode: number) {
    return Number(errcode) === 268490004;
  }

  private isInvalidAccessTokenError(error: { message?: string }) {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('40001') ||
      message.includes('invalid credential') ||
      message.includes('access_token is invalid') ||
      message.includes('not latest')
    );
  }

  private async getWechatAccessToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.wechatAccessTokenCache && this.wechatAccessTokenCache.expireAt > now + 60_000) {
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

    const maxAttempts = Math.max(1, Number(this.configService.get<string>('WECHAT_ACCESS_TOKEN_RETRY') || 5));
    const tokenUrls = this.getWechatApiUrls('/cgi-bin/stable_token');
    const tokenBody = JSON.stringify({
      grant_type: 'client_credential',
      appid,
      secret,
      force_refresh: !!forceRefresh,
    });
    let lastError: unknown;
    for (const tokenUrl of tokenUrls) {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await this.requestWechatPublicApi(tokenUrl, tokenBody, {});
          const data = response.data || {};
          if (data.errcode || !data.access_token) {
            throw new BadRequestException(data.errmsg || `获取微信 stable access_token 失败: ${data.errcode || 'unknown'}`);
          }
          this.wechatAccessTokenCache = {
            token: data.access_token,
            expireAt: now + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000,
          };
          return data.access_token;
        } catch (error) {
          lastError = error;
          if (!this.isTransientWechatApiError(error) || attempt >= maxAttempts) {
            break;
          }
          const delayMs = Math.min(5000, 500 * attempt);
          this.logger.warn(
            `获取微信 access_token 失败，准备重试 (${attempt}/${maxAttempts}): ${this.getErrorMessage(error)}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      if (lastError && !this.isTransientWechatApiError(lastError)) {
        throw lastError;
      }
      if (tokenUrl !== tokenUrls[tokenUrls.length - 1]) {
        this.logger.warn(`获取微信 access_token 失败，尝试备用线路: ${this.getErrorMessage(lastError)}`);
      }
    }

    throw lastError;
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

  private buildVirtualPayGoodsName(courseName: string, suffix = '', courseId?: number | string) {
    const source = String(courseName || '').trim() || `课程${courseId || ''}`;
    const suffixText = suffix ? ` ${suffix}` : '';
    const suffixBytes = Buffer.byteLength(suffixText, 'utf8');
    const maxBaseBytes = Math.max(1, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES - suffixBytes);
    const base = this.truncateUtf8Bytes(source, maxBaseBytes);
    let name = this.truncateUtf8Bytes(`${base}${suffixText}`, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES);
    if (!name || Buffer.byteLength(name, 'utf8') < 1) {
      name = this.truncateUtf8Bytes(`课程${courseId}${suffixText}`, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES);
    }
    return name;
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
