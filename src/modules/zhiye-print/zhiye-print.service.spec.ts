import { PDFDocument } from 'pdf-lib';
import { createHash } from 'crypto';
import { ZhiyePrintDraft, ZhiyePrintDraftStatus } from '../../database/entities/zhiye-print-draft.entity';
import { ZhiyePrintService } from './zhiye-print.service';

describe('ZhiyePrintService', () => {
  const createRepository = () => ({
    _stored: null as any,
    create: jest.fn((value) => value),
    save: jest.fn(async function (this: any, value) {
      this._stored = {
        id: value.id || 1,
        create_time: value.create_time || new Date('2026-10-01T00:00:00Z'),
        update_time: value.update_time || new Date('2026-10-01T00:00:00Z'),
        ...value,
      };
      return this._stored;
    }),
    findOne: jest.fn(function (this: any) { return Promise.resolve(this._stored); }),
    find: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ count: 0, bytes: 0 }),
    })),
  });

  const createDataSource = (repository: any) => ({
    transaction: jest.fn(async (callback) => callback({
      getRepository: (entity: any) => entity === ZhiyePrintDraft
        ? repository
        : { findOne: jest.fn().mockResolvedValue({ id: 7 }) },
    })),
  });

  it('parses the authoritative PDF page count and stores a SHA-256 owner snapshot', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const buffer = Buffer.from(await pdf.save());
    const repository = createRepository();
    const uploadService = { uploadCourseFile: jest.fn().mockResolvedValue('https://files.example/zhiye.pdf') };
    const service = new ZhiyePrintService(
      repository as any,
      uploadService as any,
      {} as any,
      createDataSource(repository) as any,
    );

    const result = await service.createDraftFromPdfBuffer(7, buffer, '练习.pdf', '数学练习');

    expect(result).toMatchObject({
      id: 1,
      title: '数学练习',
      status: ZhiyePrintDraftStatus.DRAFT,
      pageCount: 2,
      fileSize: buffer.length,
      copies: 1,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 7,
      file_url: '',
      page_count: 2,
      sha256: result.sha256,
    }));
    expect(uploadService.uploadCourseFile).toHaveBeenCalledTimes(1);
  });

  it('makes one explicit package call and zero repeated calls during the cooldown', async () => {
    const repository = createRepository();
    const draft: any = {
      id: 4,
      user_id: 7,
      title: '数学练习',
      file_name: 'math.pdf',
      file_url: 'https://files.example/math.pdf',
      file_size: 300,
      sha256: 'a'.repeat(64),
      page_count: 2,
      copies: 1,
      shipping_address: {
        name: '测试用户', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试地址',
      },
      status: ZhiyePrintDraftStatus.DRAFT,
      external_package_id: null,
      package_create_count: 0,
      package_poll_count: 0,
      quote_attempt_count: 0,
      next_quote_at: null,
      quote_operation_id: null,
      order_id: null,
      create_time: new Date(),
      update_time: new Date(),
    };
    repository._stored = draft;
    const cloudPrintService = {
      createQuotePackage: jest.fn().mockResolvedValue({ packageId: 'package-1' }),
      getQuotePackageFiles: jest.fn(),
      quotePreparedFiles: jest.fn(),
    };
    const service = new ZhiyePrintService(
      repository as any,
      {} as any,
      cloudPrintService as any,
      createDataSource(repository) as any,
    );

    await service.quoteDraft(7, 4, {});
    await service.quoteDraft(7, 4, {});

    expect(cloudPrintService.createQuotePackage).toHaveBeenCalledTimes(1);
    expect(cloudPrintService.getQuotePackageFiles).not.toHaveBeenCalled();
    expect(cloudPrintService.quotePreparedFiles).not.toHaveBeenCalled();
  });

  it('returns the existing order binding for an idempotent checkout retry', async () => {
    const repository = createRepository();
    repository._stored = {
      id: 9,
      user_id: 7,
      order_id: 81,
      title: '知页练习',
      status: ZhiyePrintDraftStatus.ORDERED,
      quote_version: 'quote-v1',
      quote_expires_at: new Date('2026-09-01T00:00:00Z'),
      retail_amount_cents: 260,
      cost_total_amount_cents: 200,
      retail_multiplier: 1.3,
      copies: 1,
      shipping_address: { name: '测试用户' },
      file_url: 'https://files.example/zhiye.pdf',
      file_name: 'zhiye.pdf',
      file_size: 300,
      sha256: 'b'.repeat(64),
      page_count: 2,
      print_config_snapshot: { duplex: 2 },
    };
    const service = new ZhiyePrintService(
      repository as any,
      {} as any,
      {} as any,
      createDataSource(repository) as any,
    );

    await expect(service.getReadyDraftForOrder(7, 9, 'quote-v1')).resolves.toMatchObject({
      orderId: 81,
      quoteVersion: 'quote-v1',
      sourceFile: { sha256: 'b'.repeat(64), file_size: 300 },
    });
  });

  it('invalidates a live quote when copies change and prices the new snapshot', async () => {
    const repository = createRepository();
    repository._stored = {
      id: 12,
      user_id: 7,
      title: '数学练习',
      file_name: 'math.pdf',
      file_url: 'https://files.example/math.pdf',
      file_size: 300,
      sha256: 'c'.repeat(64),
      page_count: 2,
      copies: 1,
      shipping_address: {
        name: '测试用户', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试地址',
      },
      status: ZhiyePrintDraftStatus.QUOTED,
      external_package_id: 'package-12',
      package_create_count: 1,
      package_poll_count: 1,
      quote_attempt_count: 1,
      next_quote_at: null,
      quote_operation_id: null,
      quote_version: 'old-quote',
      quote_expires_at: new Date(Date.now() + 60_000),
      order_id: null,
      create_time: new Date(),
      update_time: new Date(),
    };
    const cloudPrintService = {
      createQuotePackage: jest.fn(),
      getQuotePackageFiles: jest.fn().mockResolvedValue({
        ready: true,
        files: [{ downloaded: true, file: { id: 'file-12', name: '数学练习.pdf', pages: 2 } }],
      }),
      quotePreparedFiles: jest.fn().mockResolvedValue({
        printAmountCents: 100,
        shippingAmountCents: 100,
        totalAmountCents: 200,
        retailMultiplier: 1.3,
        retailAmountCents: 260,
        printConfig: { duplex: 2 },
      }),
    };
    const service = new ZhiyePrintService(
      repository as any,
      {} as any,
      cloudPrintService as any,
      createDataSource(repository) as any,
    );

    const result = await service.quoteDraft(7, 12, { copies: 2 });

    expect(cloudPrintService.quotePreparedFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ quantity: 2 })],
      expect.any(Array),
      expect.any(Object),
    );
    expect(result).toMatchObject({
      status: ZhiyePrintDraftStatus.QUOTED,
      copies: 2,
      retailAmountCents: 260,
    });
    expect(result.quoteVersion).not.toBe('old-quote');
  });

  it('reuses a recent identical PDF without a second storage upload', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const buffer = Buffer.from(await pdf.save());
    const repository = createRepository();
    repository._stored = {
      id: 21,
      user_id: 7,
      title: '已上传练习',
      file_name: 'same.pdf',
      file_url: 'https://files.example/same.pdf',
      file_size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      page_count: 1,
      copies: 1,
      status: ZhiyePrintDraftStatus.DRAFT,
      create_time: new Date(),
      update_time: new Date(),
    };
    const uploadService = { uploadCourseFile: jest.fn() };
    const service = new ZhiyePrintService(
      repository as any,
      uploadService as any,
      {} as any,
      createDataSource(repository) as any,
    );

    await expect(service.createDraftFromPdfBuffer(7, buffer, 'same.pdf'))
      .resolves.toMatchObject({ id: 21, status: ZhiyePrintDraftStatus.DRAFT });
    expect(uploadService.uploadCourseFile).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('does not let an in-flight package response overwrite a concurrent draft change', async () => {
    const repository = createRepository();
    const address = {
      name: '测试用户', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试地址',
    };
    repository._stored = {
      id: 31,
      user_id: 7,
      title: '并发练习',
      file_name: 'race.pdf',
      file_url: 'https://files.example/race.pdf',
      file_size: 300,
      sha256: 'd'.repeat(64),
      page_count: 2,
      copies: 1,
      shipping_address: address,
      status: ZhiyePrintDraftStatus.DRAFT,
      external_package_id: null,
      package_create_count: 0,
      package_poll_count: 0,
      quote_attempt_count: 0,
      next_quote_at: null,
      quote_operation_id: null,
      order_id: null,
      create_time: new Date(),
      update_time: new Date(),
    };
    let resolvePackage!: (value: { packageId: string }) => void;
    const packagePromise = new Promise<{ packageId: string }>((resolve) => {
      resolvePackage = resolve;
    });
    const cloudPrintService = {
      createQuotePackage: jest.fn().mockReturnValue(packagePromise),
      getQuotePackageFiles: jest.fn(),
      quotePreparedFiles: jest.fn(),
    };
    const service = new ZhiyePrintService(
      repository as any,
      {} as any,
      cloudPrintService as any,
      createDataSource(repository) as any,
    );

    const quotePromise = service.quoteDraft(7, 31, {});
    await Promise.resolve();
    await Promise.resolve();
    await service.updateDraft(7, 31, { copies: 2, shippingAddress: address });
    resolvePackage({ packageId: 'superseded-package' });
    await quotePromise;

    expect(cloudPrintService.createQuotePackage).toHaveBeenCalledTimes(1);
    expect(repository._stored).toMatchObject({
      copies: 2,
      status: ZhiyePrintDraftStatus.DRAFT,
      external_package_id: null,
      quote_operation_id: null,
    });
  });

  it('rejects a storage upload after the per-user daily draft limit is reserved', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const buffer = Buffer.from(await pdf.save());
    const repository = createRepository();
    repository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ count: 20, bytes: 1000 }),
    });
    const uploadService = { uploadCourseFile: jest.fn() };
    const service = new ZhiyePrintService(
      repository as any,
      uploadService as any,
      {} as any,
      createDataSource(repository) as any,
    );

    await expect(service.createDraftFromPdfBuffer(7, buffer, 'limit.pdf'))
      .rejects.toThrow('每天最多创建 20 份打印草稿');
    expect(uploadService.uploadCourseFile).not.toHaveBeenCalled();
  });
  it.each([ZhiyePrintDraftStatus.UPLOADING, ZhiyePrintDraftStatus.UPLOAD_FAILED])('refuses editing or quoting %s without changing reservation', async (status) => {
    const repository = createRepository();
    repository._stored = { id: 10, user_id: 7, status };
    const cloudPrintService = { createQuotePackage: jest.fn() };
    const service = new ZhiyePrintService(repository as any, {} as any, cloudPrintService as any, createDataSource(repository) as any);
    const address = { name: '测试', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试' };
    await expect(service.updateDraft(7, 10, { copies: 1, shippingAddress: address })).rejects.toThrow('尚未上传完成');
    await expect(service.quoteDraft(7, 10, { copies: 1, shippingAddress: address })).rejects.toThrow('尚未上传完成');
    expect(repository._stored.status).toBe(status);
    expect(repository.save).not.toHaveBeenCalled();
    expect(cloudPrintService.createQuotePackage).not.toHaveBeenCalled();
  });

});
