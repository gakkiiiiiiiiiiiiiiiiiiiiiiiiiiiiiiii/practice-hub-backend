import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import { In, Repository } from 'typeorm';
import {
  CloudPrintJob,
  CloudPrintJobStatus,
} from '../../database/entities/cloud-print-job.entity';
import { CourseFile } from '../../database/entities/course-file.entity';
import {
  Order,
  OrderDeliveryStatus,
  OrderStatus,
} from '../../database/entities/order.entity';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { UploadService } from '../upload/upload.service';
import { UpdateCloudPrintConfigDto } from './dto/update-cloud-print-config.dto';

const CLOUD_PRINT_CONFIG_KEY = 'cloud_print';
const RETRYABLE_STATUSES = [
  CloudPrintJobStatus.PENDING,
  CloudPrintJobStatus.WAITING_FILES,
  CloudPrintJobStatus.RETRYABLE_FAILED,
];

type CloudPrintConfig = UpdateCloudPrintConfigDto;

const DEFAULT_CONFIG: CloudPrintConfig = {
  autoEnabled: false,
  paperSize: 9,
  duplex: 2,
  color: 1,
  paperMedia: 1,
  pagesInOne: 1,
  bindType: 3,
  autoBindByPageCount: true,
  coverMedia: 1,
  coverColor: 5,
  coverContentType: 1,
  coverContentValue: '',
  coverContentValue2: '',
  printCollate: 0,
  orientation: 0,
  shipSupplierId: 82,
  maxSingleAmountCents: 5000,
};

@Injectable()
export class CloudPrintService {
  private readonly logger = new Logger(CloudPrintService.name);
  private workerRunning = false;

  constructor(
    @InjectRepository(CloudPrintJob)
    private readonly jobRepository: Repository<CloudPrintJob>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(CourseFile)
    private readonly courseFileRepository: Repository<CourseFile>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
    private readonly configService: ConfigService,
    private readonly uploadService: UploadService,
  ) {}

  async getConfig() {
    const row = await this.systemConfigRepository.findOne({ where: { configKey: CLOUD_PRINT_CONFIG_KEY } });
    let saved: Partial<CloudPrintConfig> = {};
    try {
      saved = row?.configValue ? JSON.parse(row.configValue) : {};
    } catch {
      saved = {};
    }
    const isLegacyBindingConfig = row?.configValue != null && !Object.prototype.hasOwnProperty.call(saved, 'autoBindByPageCount');
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      ...(isLegacyBindingConfig ? { bindType: 3 } : {}),
      configured: Boolean(this.getAppId() && this.getAppKey()),
      callbackConfigured: Boolean(this.configService.get<string>('CWY_CALLBACK_TOKEN')),
      workerEnabled: ['1', 'true', 'on', 'yes'].includes(
        String(this.configService.get('CWY_CLOUD_PRINT_WORKER_ENABLED') || 'false').toLowerCase(),
      ),
    };
  }

  async updateConfig(dto: UpdateCloudPrintConfigDto) {
    if (dto.autoEnabled && !(this.getAppId() && this.getAppKey())) {
      throw new BadRequestException('CWY_APPID 或 CWY_APPKEY 未配置，不能开启自动云打印');
    }
    if (dto.autoEnabled && !this.configService.get<string>('CWY_CALLBACK_TOKEN')) {
      throw new BadRequestException('CWY_CALLBACK_TOKEN 未配置，不能开启自动云打印');
    }
    const normalized = { ...DEFAULT_CONFIG, ...dto };
    this.validatePrintConfig(normalized);
    let row = await this.systemConfigRepository.findOne({ where: { configKey: CLOUD_PRINT_CONFIG_KEY } });
    const value = JSON.stringify(normalized);
    if (!row) {
      row = this.systemConfigRepository.create({
        configKey: CLOUD_PRINT_CONFIG_KEY,
        configValue: value,
        description: '刺猬云印自动下单与默认打印参数',
      });
    } else {
      row.configValue = value;
      row.description = '刺猬云印自动下单与默认打印参数';
    }
    await this.systemConfigRepository.save(row);
    return this.getConfig();
  }

  async enqueuePaidOrder(
    orderId: number,
    triggerType: 'automatic' | 'manual',
    operatorId?: number,
  ) {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.assertPrintableOrder(order);

    if (triggerType === 'automatic') {
      const config = await this.getConfig();
      if (!config.autoEnabled) return null;
    }

    let job = await this.jobRepository.findOne({ where: { order_id: orderId } });
    if (job?.status === CloudPrintJobStatus.SUBMITTED) return job;
    if (job?.status === CloudPrintJobStatus.REVIEW_REQUIRED) {
      throw new ConflictException('上次提交结果不明确，请先在刺猬云印后台核对，禁止直接重试以免重复扣费');
    }
    if (!job) {
      const sourceFiles = await this.createSourceSnapshot(order);
      const config = await this.getConfig();
      job = this.jobRepository.create({
        order_id: orderId,
        status: CloudPrintJobStatus.PENDING,
        trigger_type: triggerType,
        operator_id: operatorId || null,
        attempts: 0,
        max_attempts: 8,
        next_attempt_at: triggerType === 'automatic'
          ? new Date(Date.now() + 10 * 60_000)
          : new Date(),
        request_snapshot: {
          sourceFiles,
          config: this.pickPrintConfig(config),
        },
      });
      try {
        job = await this.jobRepository.save(job);
      } catch (error: any) {
        if (String(error?.code) !== 'ER_DUP_ENTRY') throw error;
        job = await this.jobRepository.findOneOrFail({ where: { order_id: orderId } });
      }
    } else if (job.status === CloudPrintJobStatus.RETRYABLE_FAILED ||
      (job.status === CloudPrintJobStatus.AWAITING_CONFIRM && triggerType === 'manual') ||
      (job.status === CloudPrintJobStatus.CANCELLED && triggerType === 'manual')) {
      job.status = CloudPrintJobStatus.PENDING;
      job.next_attempt_at = new Date();
      job.last_error = null;
      job.trigger_type = triggerType;
      job.operator_id = operatorId || job.operator_id;
      job = await this.jobRepository.save(job);
    }
    await this.syncOrderSnapshot(order, job);
    return job;
  }

  async enqueueAndProcessManual(orderId: number, operatorId?: number, expectedTotalAmountCents?: number) {
    const job = await this.enqueuePaidOrder(orderId, 'manual', operatorId);
    if (!job) throw new BadRequestException('无法创建云打印任务');
    if (job.status === CloudPrintJobStatus.SUBMITTED) return this.toPublicJob(job);
    await this.processJobById(job.id, true, expectedTotalAmountCents);
    return this.getOrderJob(orderId);
  }

  async getOrderJob(orderId: number) {
    const job = await this.jobRepository.findOne({ where: { order_id: orderId } });
    return job ? this.toAuditedPublicJob(job) : null;
  }

  async confirmProviderCancelled(orderId: number, operatorId?: number) {
    const job = await this.jobRepository.findOne({ where: { order_id: orderId } });
    if (!job) throw new NotFoundException('该订单没有云打印任务');
    const reconcilable = [
      CloudPrintJobStatus.REVIEW_REQUIRED,
      CloudPrintJobStatus.SUBMITTED,
    ];
    if (!reconcilable.includes(job.status)) {
      throw new BadRequestException('当前云打印状态不需要供应商取消确认');
    }
    const previousStatus = job.status;
    let providerCancellation: any = null;
    if (job.external_order_id) {
      providerCancellation = await this.requestApi<any>('PUT', '/api/svip/order/cancel', {
        order_id: job.external_order_id,
      }, job);
    }
    const saved = await this.updateClaimedJob(job, previousStatus, {
      status: CloudPrintJobStatus.REFUND_RESERVED,
      next_attempt_at: null,
      locked_at: null,
      last_error: '管理员已确认供应商未创建或已取消订单，退款流程已预留',
      response_snapshot: {
        ...(job.response_snapshot || {}),
        cancellationReconciliation: {
          previousStatus,
          operatorId: operatorId || null,
          confirmedAt: new Date().toISOString(),
          providerCancellation,
        },
      },
    });
    if (!saved) throw new ConflictException('云打印状态已变化，请刷新后重新核对');
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (order) await this.syncOrderSnapshot(order, saved);
    return this.toPublicJob(saved);
  }

  async reserveRefund(orderId: number) {
    const blocked = [
      CloudPrintJobStatus.SUBMITTING,
      CloudPrintJobStatus.SUBMITTED,
      CloudPrintJobStatus.REVIEW_REQUIRED,
    ];
    let job = await this.jobRepository.findOne({ where: { order_id: orderId } });
    if (job && blocked.includes(job.status)) {
      throw new BadRequestException('云打印订单可能已进入生产，请先在刺猬云印后台确认取消后再退款');
    }
    if (!job) {
      try {
        job = await this.jobRepository.save(this.jobRepository.create({
          order_id: orderId,
          status: CloudPrintJobStatus.REFUND_RESERVED,
          trigger_type: 'manual',
          attempts: 0,
          max_attempts: 8,
          last_error: '退款流程已预留，云打印任务已阻止',
          next_attempt_at: null,
        }));
      } catch (error: any) {
        if (String(error?.code) !== 'ER_DUP_ENTRY') throw error;
        job = await this.jobRepository.findOneOrFail({ where: { order_id: orderId } });
      }
    }
    if (blocked.includes(job.status)) {
      throw new BadRequestException('云打印订单可能已进入生产，请先在刺猬云印后台确认取消后再退款');
    }
    if (job.status !== CloudPrintJobStatus.REFUND_RESERVED) {
      const result = await this.jobRepository
        .createQueryBuilder()
        .update(CloudPrintJob)
        .set({
          status: CloudPrintJobStatus.REFUND_RESERVED,
          next_attempt_at: null,
          locked_at: null,
          last_error: '退款流程已预留，云打印任务已阻止',
        })
        .where('id = :id', { id: job.id })
        .andWhere('status NOT IN (:...blocked)', { blocked })
        .execute();
      if (Number(result.affected || 0) !== 1) {
        throw new BadRequestException('云打印状态已变化，请刷新订单并核对供应商后台后再退款');
      }
      job = await this.jobRepository.findOneOrFail({ where: { id: job.id } });
    }
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (order) await this.syncOrderSnapshot(order, job);
    return job;
  }

  @Cron('*/30 * * * * *')
  async processDueJobs() {
    const workerEnabled = String(this.configService.get('CWY_CLOUD_PRINT_WORKER_ENABLED') || 'false').toLowerCase();
    if (!['1', 'true', 'on', 'yes'].includes(workerEnabled)) return { scanned: 0, attempted: 0 };
    if (this.workerRunning) return { scanned: 0, attempted: 0 };
    this.workerRunning = true;
    let attempted = 0;
    try {
      const jobs = await this.jobRepository
        .createQueryBuilder('job')
        .where('(job.status IN (:...statuses) OR (job.status = :processing AND job.locked_at < :staleBefore))', {
          statuses: RETRYABLE_STATUSES,
          processing: CloudPrintJobStatus.PROCESSING,
          staleBefore: new Date(Date.now() - 10 * 60_000),
        })
        .andWhere('(job.next_attempt_at IS NULL OR job.next_attempt_at <= :now)', { now: new Date() })
        .andWhere('job.attempts < job.max_attempts')
        .orderBy('job.next_attempt_at', 'ASC')
        .addOrderBy('job.id', 'ASC')
        .take(10)
        .getMany();
      if (jobs.length === 0) {
        this.logger.debug('云打印任务: scanned=0, attempted=0');
        return { scanned: 0, attempted: 0 };
      }
      const config = await this.getConfig();
      for (const job of jobs) {
        if (job.trigger_type === 'automatic' && !config.autoEnabled) continue;
        if (await this.processJobById(job.id, false)) attempted += 1;
      }
      if (jobs.length || attempted) {
        this.logger.log(`云打印任务: scanned=${jobs.length}, attempted=${attempted}`);
      }
      return { scanned: jobs.length, attempted };
    } finally {
      this.workerRunning = false;
    }
  }

  private async processJobById(jobId: number, manual: boolean, expectedTotalAmountCents?: number) {
    const claimed = await this.jobRepository
      .createQueryBuilder()
      .update(CloudPrintJob)
      .set({ status: CloudPrintJobStatus.PROCESSING, locked_at: new Date() })
      .where('id = :jobId', { jobId })
      .andWhere('(status IN (:...statuses) OR (status = :processing AND locked_at < :staleBefore))', {
        statuses: RETRYABLE_STATUSES,
        processing: CloudPrintJobStatus.PROCESSING,
        staleBefore: new Date(Date.now() - 10 * 60_000),
      })
      .execute();
    if (Number(claimed.affected || 0) !== 1) return false;

    const job = await this.jobRepository.findOneOrFail({ where: { id: jobId } });
    const order = await this.orderRepository.findOneOrFail({ where: { id: job.order_id } });
    try {
      this.assertPrintableOrder(order);
      const liveConfig = await this.getConfig();
      if (!liveConfig.configured) throw new BadRequestException('刺猬云印密钥未配置');
      const config = { ...liveConfig, ...(job.request_snapshot?.config || {}) };

      if (!job.external_package_id) {
        const files = this.getSourceFiles(job);
        const payload = files.map((file) => ({
          url: this.uploadService.getCloudPrintDownloadUrl(file.file_url),
          name: file.display_name || file.file_name || `资料-${file.id}.${file.file_type}`,
        }));
        const response = await this.requestApi<any>('POST', '/api/svip/storage/create-package', payload, job);
        job.external_package_id = String(response?.cw_file_package_id || '');
        if (!job.external_package_id) throw new Error('云打印文件上传接口未返回批次号');
        const updated = await this.updateClaimedJob(job, CloudPrintJobStatus.PROCESSING, {
          status: CloudPrintJobStatus.WAITING_FILES,
          external_package_id: job.external_package_id,
          attempts: job.attempts + 1,
          next_attempt_at: new Date(Date.now() + 15_000),
          locked_at: null,
          last_error: null,
          response_snapshot: { ...(job.response_snapshot || {}), upload: response },
        });
        if (updated) await this.syncOrderSnapshot(order, updated);
        return true;
      }

      const packageRows = await this.requestApi<any[]>(
        'GET',
        `/api/svip/storage/package-file-list/${encodeURIComponent(job.external_package_id)}`,
        undefined,
        job,
      );
      if (!Array.isArray(packageRows) || packageRows.length === 0 || packageRows.some((item) => !item?.downloaded || !item?.file?.id)) {
        const attempts = job.attempts + 1;
        const updated = await this.updateClaimedJob(job, CloudPrintJobStatus.PROCESSING, {
          status: attempts >= job.max_attempts
            ? CloudPrintJobStatus.REVIEW_REQUIRED
            : CloudPrintJobStatus.WAITING_FILES,
          attempts,
          next_attempt_at: attempts >= job.max_attempts ? null : this.nextAttempt(attempts),
          locked_at: null,
          last_error: attempts >= job.max_attempts
            ? '云打印文件长时间未就绪，请在供应商后台人工核对'
            : '云打印文件仍在下载处理中',
        });
        if (updated) await this.syncOrderSnapshot(order, updated);
        return true;
      }

      const payload = await this.buildOrderPayload(order, this.getSourceFiles(job), packageRows, config);
      const price = await this.requestApi<any>('POST', '/api/svip/cart/calc-price', { goods: payload.goods }, job);
      const settlement = price?.origin_price;
      const printAmountCents = Number(settlement?.total_amount);
      const totalWeightGrams = Number(settlement?.total_weight);
      if (!Number.isInteger(printAmountCents) || printAmountCents < 0 || !Number.isFinite(totalWeightGrams) || totalWeightGrams <= 0) {
        throw new Error('云打印计价响应缺少有效结算金额或重量');
      }
      const shipping = await this.requestApi<any>('POST', '/api/svip/cart/calc-ship-price', {
        weight: String(totalWeightGrams),
        province: payload.address.province,
        city: payload.address.city,
        area: payload.address.area,
        ship_supplier_id: payload.address.ship_supplier_id,
      }, job);
      // 已向供应商确认 calc-ship-price 的 price 单位为元，统一换算为分参与金额保护。
      const shippingAmountCents = Math.round(Number(shipping?.price) * 100);
      if (!Number.isInteger(shippingAmountCents) || shippingAmountCents < 0) {
        throw new Error('云打印运费计价响应无效');
      }
      const quote = {
        printAmountCents,
        shippingAmountCents,
        totalAmountCents: printAmountCents + shippingAmountCents,
        totalWeightGrams,
        quotedAt: new Date().toISOString(),
        shippingUnitBasis: 'yuan_confirmed',
      };
      if (quote.totalAmountCents > Number(config.maxSingleAmountCents)) {
        const updated = await this.updateClaimedJob(job, CloudPrintJobStatus.PROCESSING, {
          status: CloudPrintJobStatus.REVIEW_REQUIRED,
          next_attempt_at: null,
          locked_at: null,
          last_error: `云打印预估总额 ¥${(quote.totalAmountCents / 100).toFixed(2)} 超过单笔上限`,
          response_snapshot: { ...(job.response_snapshot || {}), quote, price, shipping },
        });
        if (updated) await this.syncOrderSnapshot(order, updated);
        return true;
      }
      if (manual && expectedTotalAmountCents !== quote.totalAmountCents) {
        const updated = await this.updateClaimedJob(job, CloudPrintJobStatus.PROCESSING, {
          status: CloudPrintJobStatus.AWAITING_CONFIRM,
          next_attempt_at: null,
          locked_at: null,
          last_error: expectedTotalAmountCents == null
            ? '等待管理员确认云打印预估总额'
            : '云打印价格已变化，请按最新金额重新确认',
          response_snapshot: { ...(job.response_snapshot || {}), quote, price, shipping },
        });
        if (updated) await this.syncOrderSnapshot(order, updated);
        return true;
      }
      const requestSnapshot = {
        ...(job.request_snapshot || {}),
        orderRequest: this.maskPayload(payload),
        confirmedQuote: quote,
      };
      // Persist the ambiguous boundary before the billable call. If the process
      // dies after the provider accepts the order, this state is never retried.
      const submitting = await this.updateClaimedJob(job, CloudPrintJobStatus.PROCESSING, {
        status: CloudPrintJobStatus.SUBMITTING,
        request_snapshot: requestSnapshot,
      });
      if (!submitting) return true;
      Object.assign(job, submitting);
      await this.syncOrderSnapshot(order, job);

      let response: any;
      try {
        response = await this.requestApi<any>('POST', '/api/svip/order/generate', payload, job);
      } catch (error) {
        const axiosError = error as AxiosError;
        if (!axiosError.response || Number(axiosError.response.status) >= 500) {
          const updated = await this.updateClaimedJob(job, CloudPrintJobStatus.SUBMITTING, {
            status: CloudPrintJobStatus.REVIEW_REQUIRED,
            attempts: job.attempts + 1,
            last_error: '云打印订单提交结果不明确，请在刺猬云印后台核对业务订单号',
            next_attempt_at: null,
            locked_at: null,
          });
          if (updated) await this.syncOrderSnapshot(order, updated);
          return true;
        }
        throw error;
      }
      job.external_order_id = String(response?.order_id || '');
      if (!job.external_order_id) {
        const updated = await this.updateClaimedJob(job, CloudPrintJobStatus.SUBMITTING, {
          status: CloudPrintJobStatus.REVIEW_REQUIRED,
          attempts: job.attempts + 1,
          last_error: '云打印订单接口返回成功但缺少订单号，请在供应商后台核对业务订单号',
          next_attempt_at: null,
          locked_at: null,
          response_snapshot: { ...(job.response_snapshot || {}), order: response },
        });
        if (updated) await this.syncOrderSnapshot(order, updated);
        return true;
      }
      const submitted = await this.updateClaimedJob(job, CloudPrintJobStatus.SUBMITTING, {
        status: CloudPrintJobStatus.SUBMITTED,
        attempts: job.attempts + 1,
        external_order_id: job.external_order_id,
        submitted_at: new Date(),
        next_attempt_at: null,
        locked_at: null,
        last_error: null,
        response_snapshot: { ...(job.response_snapshot || {}), order: response },
      });
      if (submitted) await this.syncOrderSnapshot(order, submitted);
      return true;
    } catch (error: any) {
      const latestOrder = await this.orderRepository.findOne({ where: { id: job.order_id } });
      const latestPayload = this.parseJson(latestOrder?.pay_payload) || {};
      const noLongerEligible = !latestOrder || latestOrder.status !== OrderStatus.PAID ||
        Boolean(latestPayload?.refund?.refunded_at);
      const expectedStatus = job.status;
      const nextStatus = noLongerEligible
        ? CloudPrintJobStatus.CANCELLED
        : job.attempts + 1 >= job.max_attempts
          ? CloudPrintJobStatus.REVIEW_REQUIRED
          : CloudPrintJobStatus.RETRYABLE_FAILED;
      const attempts = job.attempts + 1;
      const lastError = String(error?.response?.data?.message || error?.message || error).slice(0, 1000);
      const failed = await this.updateClaimedJob(job, expectedStatus, {
        status: nextStatus,
        attempts,
        last_error: lastError,
        next_attempt_at: nextStatus === CloudPrintJobStatus.RETRYABLE_FAILED
          ? this.nextAttempt(attempts)
          : null,
        locked_at: null,
      });
      const current = failed || await this.jobRepository.findOne({ where: { id: job.id } });
      if (current) await this.syncOrderSnapshot(order, current);
      if (manual) {
        if (current?.status === CloudPrintJobStatus.REFUND_RESERVED) {
          throw new BadRequestException('退款流程已预留，云打印任务已取消');
        }
        throw new BadRequestException(lastError);
      }
      return true;
    }
  }

  async handleCallback(_headers: Record<string, any>, body: Record<string, any>, token?: string) {
    this.verifyCallback(token);
    const externalOrderId = String(body?.id || '').trim();
    const paymentNo = String(body?.payment_no || '').trim();
    let job = externalOrderId
      ? await this.jobRepository.findOne({ where: { external_order_id: externalOrderId } })
      : null;
    if (!job && paymentNo) {
      const candidate = await this.orderRepository.findOne({ where: { order_no: paymentNo } });
      const candidateJob = candidate
        ? await this.jobRepository.findOne({ where: { order_id: candidate.id } })
        : null;
      if (candidateJob?.request_snapshot?.orderRequest?.transcation_no === paymentNo) job = candidateJob;
    }
    const order = job ? await this.orderRepository.findOne({ where: { id: job.order_id } }) : null;
    if (!job || !order) throw new NotFoundException('未找到对应业务订单');

    const shipNo = String(body?.ship_no || '').trim();
    if (shipNo) {
      order.tracking_no = shipNo;
      order.shipper_code = String(body?.ship_supplier_code || '').trim() || null;
      order.shipper_name = String(body?.ship_supplier_name || '').trim() || null;
      order.delivery_status = OrderDeliveryStatus.SHIPPED;
      order.shipped_at = order.shipped_at || new Date();
    }
    order.logistics_snapshot = {
      provider: 'ciweiyunyin',
      orderState: body?.order_state,
      status: body?.status,
      hasException: body?.has_exception,
      detail: Array.isArray(body?.detail) ? body.detail : [],
      rawCallback: this.toJsonSafe(body),
      queriedAt: new Date().toISOString(),
    };
    const callbackHistory = Array.isArray(job?.response_snapshot?.providerCallbacks)
      ? job.response_snapshot.providerCallbacks
      : [];
    job.response_snapshot = {
      ...(job.response_snapshot || {}),
      providerCallbacks: [
        ...callbackHistory,
        {
          receivedAt: new Date().toISOString(),
          body: this.toJsonSafe(body),
        },
      ],
    };
    await this.jobRepository.update(job.id, { response_snapshot: job.response_snapshot });
    await this.orderRepository.save(order);
    return { error_no: 0, error_msg: 'ok' };
  }

  private verifyCallback(token?: string) {
    const callbackToken = String(this.configService.get<string>('CWY_CALLBACK_TOKEN') || '');
    if (!callbackToken || !token || callbackToken.length !== token.length ||
      !crypto.timingSafeEqual(Buffer.from(callbackToken), Buffer.from(token))) {
      throw new UnauthorizedException('云打印回调安全令牌无效');
    }
  }

  private async buildOrderPayload(order: Order, files: any[], packageRows: any[], config: any) {
    const packageByUrl = new Map(packageRows.map((item) => [String(item.url || ''), item]));
    const goods = files.map((file) => {
      const uploaded = packageByUrl.get(file.file_url) || packageRows.find((item) => item?.file?.name === (file.display_name || file.file_name));
      if (!uploaded?.file?.id) throw new Error(`云打印文件未就绪：${file.display_name || file.file_name || file.id}`);
      const localPages = Number(file.file_page_count || 0);
      const providerPages = Number(uploaded.file.pages || 0);
      if (localPages > 0 && providerPages > 0 && localPages !== providerPages) {
        throw new Error(`资料页数与供应商解析结果不一致：${file.display_name || file.file_name || file.id}`);
      }
      const pages = providerPages || localPages;
      if (!Number.isInteger(pages) || pages <= 0) throw new Error(`资料页数缺失：${file.display_name || file.file_name || file.id}`);
      const binding = this.resolveBinding(pages, config);
      return {
        file_id: String(uploaded.file.id),
        page_range: `1-${pages}`,
        paper_size: config.paperSize,
        copy: Math.max(1, Number(file.quantity || 1)),
        duplex: config.duplex,
        color: config.color,
        paper_media: config.paperMedia,
        pages_in_one: config.pagesInOne,
        bind_type: binding.bindType,
        ...(binding.bindType === 1 ? {
          cover_media: binding.coverMedia,
          ...(binding.coverMedia === 1 ? { cover_color: binding.coverColor } : {}),
          cover_content: this.buildCoverContent(config),
        } : {}),
        print_collate: config.printCollate,
        orientation: config.orientation,
      };
    });
    const address = order.shipping_address;
    if (!address) throw new Error('订单缺少收货地址');
    return {
      goods,
      address: {
        suid: String(order.user_id),
        name: address.name,
        mobile: address.phone,
        province: address.province,
        city: address.city,
        area: address.district,
        address: address.detail,
        ship_supplier_id: config.shipSupplierId,
        payment_method: 4,
        transcation_no: order.order_no,
      },
      pay_after: false,
    };
  }

  private async createSourceSnapshot(order: Order) {
    const payload = this.parseJson(order.pay_payload) || {};
    const ids = new Set<number>();
    if (order.course_id) ids.add(Number(order.course_id));
    for (const item of Array.isArray(payload.cart_items) ? payload.cart_items : []) {
      const id = Number(item.course_id || item.courseId || 0);
      if (id > 0) ids.add(id);
    }
    const files = await this.courseFileRepository.find({
      where: { course_id: In([...ids]), status: 1 },
      order: { course_id: 'ASC', sort: 'ASC', id: 'ASC' },
    });
    const printable = files.filter((file) => ['pdf', 'doc', 'docx'].includes(String(file.file_type).toLowerCase()));
    if (!printable.length) throw new BadRequestException('订单没有可云打印的文件');
    if (printable.some((file) => !/^https:\/\//i.test(file.file_url))) {
      throw new BadRequestException('云打印只支持可公开下载的 HTTPS 文件地址');
    }
    const cartItems = Array.isArray(payload.cart_items) ? payload.cart_items : [];
    const quantities = new Map<number, number>();
    for (const item of cartItems) {
      quantities.set(Number(item.course_id || item.courseId), Math.max(1, Number(item.quantity || 1)));
    }
    const singleQuantity = Math.max(1, Number(payload?.paper_material?.quantity || 1));
    return printable.map((file) => ({
      id: file.id,
      course_id: file.course_id,
      display_name: file.display_name,
      file_name: file.file_name,
      file_type: file.file_type,
      file_url: file.file_url,
      file_page_count: file.file_page_count,
      file_page_count_key: file.file_page_count_key,
      sort: file.sort,
      quantity: quantities.get(file.course_id) || singleQuantity,
    }));
  }

  private getSourceFiles(job: CloudPrintJob): any[] {
    const files = Array.isArray(job.request_snapshot?.sourceFiles)
      ? job.request_snapshot.sourceFiles
      : [];
    if (!files.length) throw new BadRequestException('云打印任务缺少下单时的文件快照，请人工核对');
    return files;
  }

  private pickPrintConfig(config: any) {
    const {
      configured: _configured,
      callbackConfigured: _callbackConfigured,
      workerEnabled: _workerEnabled,
      autoEnabled: _autoEnabled,
      ...printConfig
    } = config;
    return printConfig;
  }

  private assertPrintableOrder(order: Order) {
    const payload = this.parseJson(order.pay_payload) || {};
    if (order.status !== OrderStatus.PAID) throw new BadRequestException('只有已支付订单可以提交云打印');
    if (payload.fulfillment_type !== 'paper') throw new BadRequestException('只有纸质资料订单可以提交云打印');
    if (payload?.refund?.refunded_at) throw new BadRequestException('已退款订单不能提交云打印');
    if (!order.shipping_address) throw new BadRequestException('订单缺少收货地址');
  }

  private validatePrintConfig(config: CloudPrintConfig) {
    if (config.duplex === 1 && config.bindType === 2) {
      throw new BadRequestException('骑马钉只支持双面打印');
    }
    if (config.paperSize === 8 && ([1, 2, 4].includes(config.bindType) || [3, 6].includes(config.paperMedia))) {
      throw new BadRequestException('A3 不支持胶装、骑马钉、圈装或护眼纸');
    }
    if (config.paperSize === 13 && (config.color === 3 || [2, 4, 6].includes(config.paperMedia) || config.bindType === 2)) {
      throw new BadRequestException('B5 不支持标准彩印、高端/护眼纸或骑马钉');
    }
  }

  private resolveBinding(pages: number, config: CloudPrintConfig) {
    const configuredBindType = Number(config.bindType);
    const configuredRange = this.getBindingRange(configuredBindType);
    const shouldFallbackToGlue = config.autoBindByPageCount !== false &&
      configuredBindType !== 0 && configuredBindType !== 1 &&
      Boolean(configuredRange && pages > configuredRange[1]);
    const bindType = shouldFallbackToGlue ? 1 : configuredBindType;
    const effectiveConfig = { ...config, bindType };
    this.validatePrintConfig(effectiveConfig);
    this.validateBinding(pages, bindType);
    return {
      bindType,
      coverMedia: Number(config.coverMedia || 1),
      coverColor: Number(config.coverColor || 5),
    };
  }

  private getBindingRange(bindType: number): [number, number] | null {
    return bindType === 1
      ? [8, 600]
      : bindType === 2
        ? [8, 60]
        : bindType === 3
          ? [2, 160]
          : bindType === 4
            ? [8, 200]
            : null;
  }

  private validateBinding(pages: number, bindType: number) {
    const range = this.getBindingRange(bindType);
    if (range && (pages < range[0] || pages > range[1])) {
      throw new BadRequestException(`文件 ${pages} 页不符合当前装订范围 ${range[0]}-${range[1]} 页`);
    }
  }

  private buildCoverContent(config: CloudPrintConfig) {
    const type = Number(config.coverContentType || 1);
    const value = String(config.coverContentValue || '').trim();
    const value2 = String(config.coverContentValue2 || '').trim();
    if (type === 2 && !value) throw new BadRequestException('文字封面必须填写封面文字');
    if ([5, 7].includes(type) && !value) throw new BadRequestException('当前封面类型必须填写封面图片 URL');
    if (type === 6 && (!value || !value2)) throw new BadRequestException('分离封面必须填写封面和封底图片 URL');
    if ([5, 6, 7].includes(type) && ![value, ...(type === 6 ? [value2] : [])].every((item) => this.isHttpsUrl(item))) {
      throw new BadRequestException('封面图片必须使用可公开访问的 HTTPS URL');
    }
    return {
      type: String(type),
      ...(value ? { value } : {}),
      ...(value2 ? { value2 } : {}),
    };
  }

  private isHttpsUrl(value: string) {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async requestApi<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    data?: unknown,
    auditJob?: CloudPrintJob,
  ): Promise<T> {
    const body = method === 'GET' ? '' : JSON.stringify(data ?? {});
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const requestedAt = new Date().toISOString();
    const secret = crypto.createHash('sha1').update(`${this.getAppId()}${this.getAppKey()}${timestamp}${body}`).digest('hex');
    let response: any;
    try {
      response = await axios.request({
        method,
        url: `${String(this.configService.get('CWY_BASE_URL') || 'https://ciweiyunyin.com').replace(/\/$/, '')}${path}`,
        data: method === 'GET' ? undefined : body,
        timeout: Math.max(3000, Number(this.configService.get('CWY_TIMEOUT_MS') || 15000)),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-AUTH-APPID': this.getAppId(),
          'X-AUTH-TIMESTAMP': timestamp,
          'X-AUTH-SECRET': secret,
        },
        validateStatus: () => true,
      });
    } catch (error: any) {
      if (auditJob) {
        await this.recordProviderResponse(auditJob, {
          method,
          path,
          requestedAt,
          respondedAt: new Date().toISOString(),
          requestBody: method === 'GET' ? null : this.toJsonSafe(data),
          httpStatus: error?.response?.status ?? null,
          headers: this.toJsonSafe(error?.response?.headers),
          body: this.toJsonSafe(error?.response?.data),
          transportError: String(error?.message || error),
        });
      }
      throw error;
    }
    const envelope = response.data;
    if (auditJob) {
      await this.recordProviderResponse(auditJob, {
        method,
        path,
        requestedAt,
        respondedAt: new Date().toISOString(),
        requestBody: method === 'GET' ? null : this.toJsonSafe(data),
        httpStatus: response.status,
        headers: this.toJsonSafe(response.headers),
        body: this.toJsonSafe(envelope),
      });
    }
    if (response.status >= 400 || (envelope && typeof envelope === 'object' && 'code' in envelope && Number(envelope.code) !== 0)) {
      const error = new Error(String(envelope?.message || `云打印接口响应 ${response.status}`)) as AxiosError;
      error.response = response as any;
      throw error;
    }
    return (envelope && typeof envelope === 'object' && 'code' in envelope ? envelope.data : envelope) as T;
  }

  private async updateClaimedJob(
    job: CloudPrintJob,
    expectedStatus: CloudPrintJobStatus,
    patch: Partial<CloudPrintJob>,
  ) {
    const result = await this.jobRepository
      .createQueryBuilder()
      .update(CloudPrintJob)
      .set(patch as any)
      .where('id = :id', { id: job.id })
      .andWhere('status = :expectedStatus', { expectedStatus })
      .execute();
    if (Number(result.affected || 0) !== 1) return null;
    return this.jobRepository.findOne({ where: { id: job.id } });
  }

  private async syncOrderSnapshot(order: Order, job: CloudPrintJob) {
    const fresh = await this.orderRepository.findOne({ where: { id: order.id } });
    if (!fresh) return;
    fresh.pay_payload = {
      ...(this.parseJson(fresh.pay_payload) || {}),
      cloud_print: this.toPublicJob(job),
    };
    await this.orderRepository.save(fresh);
  }

  private toPublicJob(job: CloudPrintJob) {
    const result: Record<string, any> = {
      status: job.status,
      triggerType: job.trigger_type,
      externalPackageId: job.external_package_id || '',
      externalOrderId: job.external_order_id || '',
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      lastError: job.last_error || '',
      quote: job.response_snapshot?.quote || null,
      nextAttemptAt: job.next_attempt_at || null,
      submittedAt: job.submitted_at || null,
      updatedAt: job.update_time || null,
    };
    return result;
  }

  private toAuditedPublicJob(job: CloudPrintJob) {
    return {
      ...this.toPublicJob(job),
      responseSnapshot: job.response_snapshot || null,
      providerResponses: Array.isArray(job.response_snapshot?.providerResponses)
        ? job.response_snapshot.providerResponses
        : [],
      providerCallbacks: Array.isArray(job.response_snapshot?.providerCallbacks)
        ? job.response_snapshot.providerCallbacks
        : [],
    };
  }

  private async recordProviderResponse(job: CloudPrintJob, response: Record<string, any>) {
    const history = Array.isArray(job.response_snapshot?.providerResponses)
      ? job.response_snapshot.providerResponses
      : [];
    job.response_snapshot = {
      ...(job.response_snapshot || {}),
      providerResponses: [...history, response],
    };
    await this.jobRepository.update(job.id, { response_snapshot: job.response_snapshot });
  }

  private toJsonSafe(value: any) {
    if (value == null) return value ?? null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  private maskPayload(payload: any) {
    return {
      ...payload,
      address: payload?.address ? {
        ...payload.address,
        mobile: `${String(payload.address.mobile || '').slice(0, 3)}****${String(payload.address.mobile || '').slice(-4)}`,
        address: '[已保存于业务订单]',
      } : undefined,
    };
  }

  private nextAttempt(attempts: number) {
    return new Date(Date.now() + Math.min(10 * 60_000, 15_000 * (2 ** Math.min(5, attempts))));
  }

  private parseJson(value: any) {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
  }

  private getAppId() {
    return String(this.configService.get<string>('CWY_APPID') || '').trim();
  }

  private getAppKey() {
    return String(this.configService.get<string>('CWY_APPKEY') || '').trim();
  }
}
