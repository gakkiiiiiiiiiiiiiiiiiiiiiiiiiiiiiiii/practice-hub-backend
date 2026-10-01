import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PDFDocument } from 'pdf-lib';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull, MoreThan, Repository } from 'typeorm';
import { normalizeUploadedFileName } from '../../common/utils/file-name-encoding';
import {
  ZhiyePrintDraft,
  ZhiyePrintDraftStatus,
} from '../../database/entities/zhiye-print-draft.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import {
  CloudPrintQuoteSourceFile,
  CloudPrintService,
} from '../cloud-print/cloud-print.service';
import { UploadService } from '../upload/upload.service';
import { QuoteZhiyePrintDraftDto } from './dto/quote-zhiye-print-draft.dto';
import { UpdateZhiyePrintDraftDto } from './dto/update-zhiye-print-draft.dto';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 2000;
const MAX_DAILY_UPLOADS_PER_USER = 20;
const MAX_DAILY_UPLOAD_BYTES_PER_USER = 100 * 1024 * 1024;
const UPLOAD_RESERVATION_STALE_MS = 15 * 60_000;
const MAX_PACKAGE_POLLS = 8;
const MAX_PACKAGE_CREATES = 3;
const MAX_QUOTE_ATTEMPTS = 5;
const QUOTE_COOLDOWN_MS = 15_000;
const QUOTE_RESERVATION_MS = 60_000;
const QUOTE_TTL_MS = 10 * 60_000;

@Injectable()
export class ZhiyePrintService {
  constructor(
    @InjectRepository(ZhiyePrintDraft)
    private readonly draftRepository: Repository<ZhiyePrintDraft>,
    private readonly uploadService: UploadService,
    private readonly cloudPrintService: CloudPrintService,
    private readonly dataSource: DataSource,
  ) {}

  async createDraftFromPdfBuffer(
    userId: number,
    buffer: Buffer,
    fileName: string,
    title?: string,
  ) {
    this.assertOwnerId(userId);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new BadRequestException('请选择 PDF 文件');
    }
    if (buffer.length > MAX_PDF_BYTES) {
      throw new BadRequestException('PDF 文件不能超过 50MB');
    }
    const safeFileName = this.sanitizePdfFileName(fileName);
    if (!buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'))) {
      throw new BadRequestException('文件内容不是有效 PDF');
    }

    let pageCount: number;
    try {
      const pdf = await PDFDocument.load(buffer);
      pageCount = pdf.getPageCount();
    } catch {
      throw new BadRequestException('PDF 无法解析、已加密或文件已损坏');
    }
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw new BadRequestException(`PDF 页数必须为 1-${MAX_PDF_PAGES} 页`);
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const reservation = await this.reserveUploadDraft(
      userId,
      safeFileName,
      this.normalizeTitle(title, safeFileName),
      buffer.length,
      sha256,
      pageCount,
    );
    if (reservation.reused) return this.toPublicDraft(reservation.draft);

    const file = {
      fieldname: 'file',
      originalname: safeFileName,
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
      stream: undefined,
      destination: '',
      filename: safeFileName,
      path: '',
    } as unknown as Express.Multer.File;
    try {
      const fileUrl = await this.uploadService.uploadCourseFile(file, '');
      return this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ZhiyePrintDraft);
        const draft = await this.findOwnedDraft(userId, reservation.draft.id, manager, true);
        if (draft.status !== ZhiyePrintDraftStatus.UPLOADING) {
          throw new ConflictException('上传草稿状态已变化，请刷新后重试');
        }
        draft.file_url = fileUrl;
        draft.status = ZhiyePrintDraftStatus.DRAFT;
        draft.last_error = null;
        return this.toPublicDraft(await repository.save(draft));
      });
    } catch (error: any) {
      await this.markUploadFailed(userId, reservation.draft.id, error);
      throw error;
    }
  }

  private async reserveUploadDraft(
    userId: number,
    fileName: string,
    title: string,
    fileSize: number,
    sha256: string,
    pageCount: number,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(AppUser).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new BadRequestException('用户身份无效');
      const repository = manager.getRepository(ZhiyePrintDraft);
      const recent = await repository.findOne({
        where: {
          user_id: userId,
          sha256,
          status: In([
            ZhiyePrintDraftStatus.UPLOADING,
            ZhiyePrintDraftStatus.DRAFT,
            ZhiyePrintDraftStatus.WAITING_FILES,
            ZhiyePrintDraftStatus.QUOTED,
          ]),
          create_time: MoreThan(new Date(Date.now() - 24 * 60 * 60_000)),
        },
        order: { create_time: 'DESC' },
      });
      if (recent) {
        if (recent.status === ZhiyePrintDraftStatus.UPLOADING) {
          const updatedAt = recent.update_time instanceof Date
            ? recent.update_time.getTime()
            : new Date(recent.update_time).getTime();
          if (Number.isFinite(updatedAt) && updatedAt > Date.now() - UPLOAD_RESERVATION_STALE_MS) {
            throw new ConflictException('相同 PDF 正在上传，请稍后刷新草稿列表');
          }
          recent.status = ZhiyePrintDraftStatus.UPLOAD_FAILED;
          recent.last_error = '上传预留超时，已允许重新上传';
          await repository.save(recent);
        } else {
          return { draft: recent, reused: true as const };
        }
      }

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const quota = await repository.createQueryBuilder('draft')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(draft.file_size), 0)', 'bytes')
        .where('draft.user_id = :userId', { userId })
        .andWhere('draft.create_time >= :startOfDay', { startOfDay })
        .andWhere('draft.status != :failed', { failed: ZhiyePrintDraftStatus.UPLOAD_FAILED })
        .getRawOne();
      const dailyCount = Number(quota?.count || 0);
      const dailyBytes = Number(quota?.bytes || 0);
      if (dailyCount >= MAX_DAILY_UPLOADS_PER_USER) {
        throw new BadRequestException(`每天最多创建 ${MAX_DAILY_UPLOADS_PER_USER} 份打印草稿`);
      }
      if (dailyBytes + fileSize > MAX_DAILY_UPLOAD_BYTES_PER_USER) {
        throw new BadRequestException('每天上传 PDF 总量不能超过 100MB');
      }

      const draft = repository.create({
        user_id: userId,
        title,
        file_name: fileName,
        file_url: '',
        file_size: fileSize,
        sha256,
        page_count: pageCount,
        copies: 1,
        shipping_address: null,
        status: ZhiyePrintDraftStatus.UPLOADING,
        external_package_id: null,
        package_create_count: 0,
        package_poll_count: 0,
        quote_attempt_count: 0,
        next_quote_at: null,
        quote_operation_id: null,
        cost_print_amount_cents: null,
        cost_shipping_amount_cents: null,
        cost_total_amount_cents: null,
        retail_multiplier: null,
        retail_amount_cents: null,
        print_config_snapshot: null,
        quote_version: null,
        quote_expires_at: null,
        order_id: null,
        last_error: null,
      });
      return { draft: await repository.save(draft), reused: false as const };
    });
  }

  private async markUploadFailed(userId: number, id: number, error: any) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ZhiyePrintDraft);
        const draft = await this.findOwnedDraft(userId, id, manager, true);
        if (draft.status !== ZhiyePrintDraftStatus.UPLOADING) return;
        draft.status = ZhiyePrintDraftStatus.UPLOAD_FAILED;
        draft.last_error = String(error?.message || 'PDF 上传失败').slice(0, 1000);
        await repository.save(draft);
      });
    } catch {
      // Preserve the original upload error. The reserved row remains bounded by
      // the daily quota and can be reconciled without another storage request.
    }
  }

  async updateDraft(userId: number, id: number, dto: UpdateZhiyePrintDraftDto) {
    const address = this.normalizeAddress(dto.shippingAddress);
    return this.dataSource.transaction(async (manager) => {
      const draft = await this.findOwnedDraft(userId, id, manager, true);
      this.assertEditable(draft);
      const changed = draft.copies !== dto.copies ||
        JSON.stringify(draft.shipping_address) !== JSON.stringify(address);
      draft.copies = dto.copies;
      draft.shipping_address = address;
      if (changed) this.clearQuote(draft);
      return this.toPublicDraft(await manager.getRepository(ZhiyePrintDraft).save(draft));
    });
  }

  async listDrafts(userId: number) {
    this.assertOwnerId(userId);
    const rows = await this.draftRepository.find({
      where: { user_id: userId },
      order: { create_time: 'DESC' },
      take: 100,
    });
    return rows.map((row) => this.toPublicDraft(row));
  }

  async getDraft(userId: number, id: number) {
    return this.toPublicDraft(await this.findOwnedDraft(userId, id));
  }

  async getDraftPreview(userId: number, id: number) {
    const draft = await this.findOwnedDraft(userId, id);
    if (!draft.file_url || [
      ZhiyePrintDraftStatus.UPLOADING,
      ZhiyePrintDraftStatus.UPLOAD_FAILED,
    ].includes(draft.status)) {
      throw new ConflictException('PDF 尚未上传完成，暂时无法预览');
    }
    return { url: this.uploadService.getAuthorizedCourseFileUrl(draft.file_url) };
  }

  async quoteDraft(userId: number, id: number, dto: QuoteZhiyePrintDraftDto) {
    const reservation = await this.reserveQuoteOperation(userId, id, dto);
    if (reservation.kind === 'cached') return reservation.data;
    try {
      if (reservation.kind === 'create_package') {
        const result = await this.cloudPrintService.createQuotePackage([reservation.sourceFile]);
        return this.finalizeQuoteOperation(userId, id, reservation.operationId, (draft) => {
          draft.external_package_id = result.packageId;
          draft.status = ZhiyePrintDraftStatus.WAITING_FILES;
          draft.next_quote_at = new Date(Date.now() + QUOTE_COOLDOWN_MS);
          draft.last_error = null;
        });
      }
      const prepared = await this.cloudPrintService.getQuotePackageFiles(reservation.packageId);
      if (!prepared.ready) {
        return this.finalizeQuoteOperation(userId, id, reservation.operationId, (draft) => {
          draft.status = draft.package_poll_count >= MAX_PACKAGE_POLLS
            ? ZhiyePrintDraftStatus.QUOTE_FAILED
            : ZhiyePrintDraftStatus.WAITING_FILES;
          draft.next_quote_at = draft.status === ZhiyePrintDraftStatus.QUOTE_FAILED
            ? null
            : new Date(Date.now() + QUOTE_COOLDOWN_MS);
          draft.last_error = draft.status === ZhiyePrintDraftStatus.QUOTE_FAILED
            ? '云打印文件准备超时，请重新上传 PDF 后再试'
            : '云打印文件仍在准备中';
        });
      }
      const quoteContext = await this.reservePricingOperation(
        userId,
        id,
        reservation.operationId,
      );
      if (!quoteContext) return this.getDraft(userId, id);
      const quote = await this.cloudPrintService.quotePreparedFiles(
        [quoteContext.sourceFile],
        prepared.files,
        {
          userId,
          referenceNo: `ZHIYE-DRAFT-${id}-${quoteContext.quoteAttemptCount}`,
          name: quoteContext.address.name,
          phone: quoteContext.address.phone,
          province: quoteContext.address.province,
          city: quoteContext.address.city,
          district: quoteContext.address.district,
          detail: quoteContext.address.detail,
        },
      );
      return this.finalizeQuoteOperation(userId, id, reservation.operationId, (draft) => {
        draft.status = ZhiyePrintDraftStatus.QUOTED;
        draft.cost_print_amount_cents = quote.printAmountCents;
        draft.cost_shipping_amount_cents = quote.shippingAmountCents;
        draft.cost_total_amount_cents = quote.totalAmountCents;
        draft.retail_multiplier = quote.retailMultiplier;
        draft.retail_amount_cents = quote.retailAmountCents;
        draft.print_config_snapshot = quote.printConfig;
        draft.quote_version = randomUUID();
        draft.quote_expires_at = new Date(Date.now() + QUOTE_TTL_MS);
        draft.next_quote_at = null;
        draft.last_error = null;
      });
    } catch (error: any) {
      await this.recordQuoteError(userId, id, reservation.operationId, error);
      throw error;
    }
  }

  private async reserveQuoteOperation(
    userId: number,
    id: number,
    dto: QuoteZhiyePrintDraftDto,
  ): Promise<any> {
    const normalizedAddress = dto.shippingAddress
      ? this.normalizeAddress(dto.shippingAddress)
      : undefined;
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ZhiyePrintDraft);
      const draft = await this.findOwnedDraft(userId, id, manager, true);
      this.assertEditable(draft);
      const changed = (dto.copies != null && draft.copies !== dto.copies) ||
        (normalizedAddress != null &&
          JSON.stringify(draft.shipping_address) !== JSON.stringify(normalizedAddress));
      if (dto.copies != null) draft.copies = dto.copies;
      if (normalizedAddress) draft.shipping_address = normalizedAddress;
      if (changed) this.clearQuote(draft);
      if (!draft.shipping_address) throw new BadRequestException('请先填写收货地址');
      if (!Number.isInteger(draft.copies) || draft.copies < 1 || draft.copies > 99) {
        throw new BadRequestException('打印份数必须为 1-99');
      }

      const now = new Date();
      if (!changed &&
        draft.status === ZhiyePrintDraftStatus.QUOTED &&
        draft.quote_expires_at &&
        draft.quote_expires_at > now) {
        return { kind: 'cached', data: this.toPublicDraft(draft) };
      }
      if (draft.next_quote_at && draft.next_quote_at > now) {
        if (changed) await repository.save(draft);
        return { kind: 'cached', data: this.toPublicDraft(draft) };
      }

      if (!draft.external_package_id && draft.package_create_count >= MAX_PACKAGE_CREATES) {
        draft.status = ZhiyePrintDraftStatus.QUOTE_FAILED;
        draft.quote_operation_id = null;
        draft.next_quote_at = null;
        draft.last_error = '云打印文件包创建次数已达上限，请重新上传 PDF';
        return { kind: 'cached', data: this.toPublicDraft(await repository.save(draft)) };
      }
      if (draft.external_package_id && draft.package_poll_count >= MAX_PACKAGE_POLLS) {
        draft.status = ZhiyePrintDraftStatus.QUOTE_FAILED;
        draft.quote_operation_id = null;
        draft.next_quote_at = null;
        draft.last_error = '云打印文件准备超时，请重新上传 PDF 后再试';
        return { kind: 'cached', data: this.toPublicDraft(await repository.save(draft)) };
      }
      if (draft.quote_attempt_count >= MAX_QUOTE_ATTEMPTS) {
        draft.status = ZhiyePrintDraftStatus.QUOTE_FAILED;
        draft.quote_operation_id = null;
        draft.next_quote_at = null;
        draft.last_error = '本草稿报价次数已达上限，请重新创建草稿';
        return { kind: 'cached', data: this.toPublicDraft(await repository.save(draft)) };
      }

      const operationId = randomUUID();
      draft.quote_operation_id = operationId;
      draft.status = ZhiyePrintDraftStatus.WAITING_FILES;
      draft.next_quote_at = new Date(now.getTime() + QUOTE_RESERVATION_MS);
      draft.last_error = null;
      const sourceFile = this.toQuoteSourceFile(draft);
      if (!draft.external_package_id) {
        draft.package_create_count += 1;
        await repository.save(draft);
        return { kind: 'create_package', operationId, sourceFile };
      }
      draft.package_poll_count += 1;
      const packageId = draft.external_package_id;
      await repository.save(draft);
      return { kind: 'poll_package', operationId, sourceFile, packageId };
    });
  }

  private async reservePricingOperation(
    userId: number,
    id: number,
    operationId: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ZhiyePrintDraft);
      const draft = await this.findOwnedDraft(userId, id, manager, true);
      if (draft.quote_operation_id !== operationId || draft.order_id) return null;
      if (draft.quote_attempt_count >= MAX_QUOTE_ATTEMPTS) {
        draft.status = ZhiyePrintDraftStatus.QUOTE_FAILED;
        draft.quote_operation_id = null;
        draft.next_quote_at = null;
        draft.last_error = '本草稿报价次数已达上限，请重新创建草稿';
        await repository.save(draft);
        return null;
      }
      draft.quote_attempt_count += 1;
      draft.next_quote_at = new Date(Date.now() + QUOTE_RESERVATION_MS);
      await repository.save(draft);
      return {
        sourceFile: this.toQuoteSourceFile(draft),
        address: draft.shipping_address as Record<string, string>,
        quoteAttemptCount: draft.quote_attempt_count,
      };
    });
  }

  private async finalizeQuoteOperation(
    userId: number,
    id: number,
    operationId: string,
    mutate: (draft: ZhiyePrintDraft) => void,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ZhiyePrintDraft);
      const draft = await this.findOwnedDraft(userId, id, manager, true);
      if (draft.quote_operation_id !== operationId || draft.order_id) {
        return this.toPublicDraft(draft);
      }
      mutate(draft);
      draft.quote_operation_id = null;
      return this.toPublicDraft(await repository.save(draft));
    });
  }

  private async recordQuoteError(
    userId: number,
    id: number,
    operationId: string,
    error: any,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ZhiyePrintDraft);
      const draft = await this.findOwnedDraft(userId, id, manager, true);
      if (draft.quote_operation_id !== operationId || draft.order_id) return;
      draft.quote_operation_id = null;
      draft.last_error = String(error?.message || '云打印报价失败').slice(0, 1000);
      draft.next_quote_at = new Date(Date.now() + QUOTE_COOLDOWN_MS);
      await repository.save(draft);
    });
  }

  async getReadyDraftForOrder(
    userId: number,
    id: number,
    quoteVersion: string,
    manager?: EntityManager,
  ) {
    const draft = await this.findOwnedDraft(userId, id, manager, Boolean(manager));
    if (!quoteVersion || draft.quote_version !== quoteVersion) {
      throw new ConflictException('报价版本已变化，请刷新后重新下单');
    }
    // 重复请求命中已绑定订单时返回同一绑定，调用方据此读取原订单。
    // 此时不再要求报价仍在有效期内，避免支付页面重试创建第二笔订单。
    if (draft.order_id) return this.toOrderSnapshot(draft);
    if (
      draft.status !== ZhiyePrintDraftStatus.QUOTED ||
      !draft.quote_version ||
      !draft.quote_expires_at ||
      draft.quote_expires_at <= new Date() ||
      !Number.isInteger(draft.retail_amount_cents) ||
      Number(draft.retail_amount_cents) < 0
    ) {
      throw new ConflictException('报价不存在或已过期，请重新报价');
    }
    return this.toOrderSnapshot(draft);
  }

  private toOrderSnapshot(draft: ZhiyePrintDraft) {
    return {
      draftId: draft.id,
      orderId: draft.order_id,
      title: draft.title,
      quoteVersion: draft.quote_version,
      quoteExpiresAt: draft.quote_expires_at,
      retailAmountCents: draft.retail_amount_cents,
      costPrintAmountCents: draft.cost_print_amount_cents,
      costShippingAmountCents: draft.cost_shipping_amount_cents,
      costTotalAmountCents: draft.cost_total_amount_cents,
      retailMultiplier: Number(draft.retail_multiplier),
      copies: draft.copies,
      shippingAddress: draft.shipping_address,
      sourceFile: {
        ...this.toQuoteSourceFile(draft),
        sha256: draft.sha256,
        file_size: Number(draft.file_size),
      },
      printConfig: draft.print_config_snapshot,
    };
  }

  async attachOrder(
    userId: number,
    id: number,
    orderId: number,
    manager?: EntityManager,
  ) {
    const repository = manager?.getRepository(ZhiyePrintDraft) || this.draftRepository;
    const existing = await this.findOwnedDraft(userId, id, manager, Boolean(manager));
    if (existing.order_id === orderId) return this.toPublicDraft(existing);
    if (existing.order_id) throw new ConflictException('该打印草稿已绑定其他订单');
    const result = await repository.update(
      {
        id,
        user_id: userId,
        status: ZhiyePrintDraftStatus.QUOTED,
        order_id: IsNull(),
      },
      { order_id: orderId, status: ZhiyePrintDraftStatus.ORDERED },
    );
    if (!result.affected) throw new ConflictException('打印草稿状态已变化，请刷新后重试');
    const attached = await repository.findOne({ where: { id, user_id: userId } });
    if (!attached) throw new NotFoundException('打印草稿不存在');
    return this.toPublicDraft(attached);
  }

  private async findOwnedDraft(
    userId: number,
    id: number,
    manager?: EntityManager,
    lockForUpdate = false,
  ) {
    this.assertOwnerId(userId);
    if (!Number.isInteger(id) || id < 1) throw new NotFoundException('打印草稿不存在');
    const repository = manager?.getRepository(ZhiyePrintDraft) || this.draftRepository;
    const draft = await repository.findOne({
      where: { id, user_id: userId },
      ...(lockForUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!draft) throw new NotFoundException('打印草稿不存在');
    return draft;
  }

  private assertOwnerId(userId: number) {
    if (!Number.isInteger(userId) || userId < 1) throw new BadRequestException('用户身份无效');
  }

  private assertEditable(draft: ZhiyePrintDraft) {
    if ([ZhiyePrintDraftStatus.UPLOADING, ZhiyePrintDraftStatus.UPLOAD_FAILED].includes(draft.status)) {
      throw new ConflictException('PDF 尚未上传完成，请完成上传后再修改或报价');
    }
    if (draft.order_id || draft.status === ZhiyePrintDraftStatus.ORDERED) {
      throw new ConflictException('已创建订单的打印草稿不能修改');
    }
    if (draft.status === ZhiyePrintDraftStatus.QUOTE_FAILED) {
      throw new ConflictException('本草稿已停止报价，请重新创建草稿');
    }
  }

  private clearQuote(draft: ZhiyePrintDraft) {
    draft.status = draft.external_package_id
      ? ZhiyePrintDraftStatus.WAITING_FILES
      : ZhiyePrintDraftStatus.DRAFT;
    draft.cost_print_amount_cents = null;
    draft.cost_shipping_amount_cents = null;
    draft.cost_total_amount_cents = null;
    draft.retail_multiplier = null;
    draft.retail_amount_cents = null;
    draft.print_config_snapshot = null;
    draft.quote_version = null;
    draft.quote_expires_at = null;
    draft.quote_operation_id = null;
    draft.next_quote_at = null;
    draft.last_error = null;
  }

  private toQuoteSourceFile(draft: ZhiyePrintDraft): CloudPrintQuoteSourceFile {
    return {
      file_url: draft.file_url,
      display_name: draft.title,
      file_name: draft.file_name,
      file_type: 'pdf',
      file_page_count: draft.page_count,
      quantity: draft.copies,
    };
  }

  private toPublicDraft(draft: ZhiyePrintDraft) {
    return {
      id: draft.id,
      title: draft.title,
      status: draft.status,
      fileName: draft.file_name,
      fileSize: Number(draft.file_size),
      pageCount: draft.page_count,
      sha256: draft.sha256,
      copies: draft.copies,
      shippingAddress: draft.shipping_address,
      retailAmountCents: draft.retail_amount_cents,
      quoteVersion: draft.quote_version,
      quoteExpiresAt: draft.quote_expires_at,
      nextQuoteAt: draft.next_quote_at,
      packageCreateCount: draft.package_create_count,
      packagePollCount: draft.package_poll_count,
      quoteAttemptCount: draft.quote_attempt_count,
      orderId: draft.order_id,
      lastError: draft.last_error,
      createTime: draft.create_time,
      updateTime: draft.update_time,
    };
  }

  private normalizeAddress(address: Record<string, any>) {
    const result: Record<string, string> = {};
    for (const key of ['name', 'phone', 'province', 'city', 'district', 'detail']) {
      const value = String(address?.[key] || '').trim();
      if (!value) throw new BadRequestException('收货地址信息不完整');
      result[key] = value;
    }
    for (const key of ['postalCode', 'nationalCode']) {
      const value = String(address?.[key] || '').trim();
      if (value) result[key] = value;
    }
    return result;
  }

  private sanitizePdfFileName(fileName: string) {
    const normalized = normalizeUploadedFileName(fileName || '知页练习.pdf')
      .replace(/[\\/]/g, '')
      .replace(/\.\./g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 255);
    if (!normalized.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('仅支持 PDF 文件');
    }
    return normalized || '知页练习.pdf';
  }

  private normalizeTitle(title: string | undefined, fileName: string) {
    const fallback = fileName.replace(/\.pdf$/i, '');
    return String(title || fallback || '知页练习')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 120) || '知页练习';
  }
}
