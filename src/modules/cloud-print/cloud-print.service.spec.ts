import axios from 'axios';
import * as crypto from 'crypto';
import { CloudPrintService } from './cloud-print.service';
import { CloudPrintJobStatus } from '../../database/entities/cloud-print-job.entity';

jest.mock('axios');

describe('CloudPrintService', () => {
  afterEach(() => jest.resetAllMocks());

  const printConfig = {
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

  const buildPayload = (service: any, pages: number, config: any = printConfig) => service.buildOrderPayload(
    {
      user_id: 10,
      order_no: 'ORDER-1',
      shipping_address: {
        name: '测试用户', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试地址',
      },
    },
    [{ file_url: 'https://example.com/file.pdf', display_name: '测试资料', file_page_count: pages, quantity: 1 }],
    [{ url: 'https://example.com/file.pdf', file: { id: 'file-1', pages } }],
    config,
  );

  it('signs the exact JSON body required by Ciwei Cloud Print', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string) => ({
        CWY_APPID: 'app-id',
        CWY_APPKEY: 'app-key',
        CWY_BASE_URL: 'https://ciweiyunyin.com',
        CWY_TIMEOUT_MS: 15000,
      })[key]),
    };
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    (axios.request as jest.Mock).mockResolvedValue({
      status: 200,
      data: { code: 0, message: 'ok', data: { order_id: 'CWY-1' } },
    });

    const payload = { goods: [{ file_id: '1', copy: 2 }], pay_after: false };
    await expect(service.requestApi('POST', '/api/svip/order/generate', payload))
      .resolves.toEqual({ order_id: 'CWY-1' });

    const request = (axios.request as jest.Mock).mock.calls[0][0];
    const body = JSON.stringify(payload);
    const expected = crypto.createHash('sha1')
      .update(`app-idapp-key1700000000${body}`)
      .digest('hex');
    expect(request.data).toBe(body);
    expect(request.headers).toMatchObject({
      'X-AUTH-APPID': 'app-id',
      'X-AUTH-TIMESTAMP': '1700000000',
      'X-AUTH-SECRET': expected,
    });
  });

  it('persists the complete provider request and response without auth credentials', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string) => ({
        CWY_APPID: 'app-id',
        CWY_APPKEY: 'app-key',
        CWY_BASE_URL: 'https://ciweiyunyin.com',
        CWY_TIMEOUT_MS: 15000,
      })[key]),
    };
    service.jobRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    (axios.request as jest.Mock).mockResolvedValue({
      status: 200,
      headers: { 'x-request-id': 'request-1' },
      data: { code: 0, message: 'ok', data: { origin_price: { total_amount: 935 } } },
    });
    const job: any = { id: 8, response_snapshot: { upload: { cw_file_package_id: 'package-1' } } };
    const payload = { goods: [{ file_id: 'file-1', bind_type: 0 }] };

    await expect(service.requestApi('POST', '/api/svip/cart/calc-price', payload, job))
      .resolves.toEqual({ origin_price: { total_amount: 935 } });

    const audit = job.response_snapshot.providerResponses[0];
    expect(audit).toMatchObject({
      method: 'POST',
      path: '/api/svip/cart/calc-price',
      requestBody: payload,
      httpStatus: 200,
      headers: { 'x-request-id': 'request-1' },
      body: { code: 0, message: 'ok', data: { origin_price: { total_amount: 935 } } },
    });
    expect(JSON.stringify(audit)).not.toContain('app-key');
    expect(JSON.stringify(audit)).not.toContain('X-AUTH-SECRET');
    expect(service.jobRepository.update).toHaveBeenCalledWith(8, {
      response_snapshot: job.response_snapshot,
    });
  });

  it('persists the complete provider error response before rejecting the request', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string) => ({
        CWY_APPID: 'app-id',
        CWY_APPKEY: 'app-key',
        CWY_BASE_URL: 'https://ciweiyunyin.com',
        CWY_TIMEOUT_MS: 15000,
      })[key]),
    };
    service.jobRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    (axios.request as jest.Mock).mockResolvedValue({
      status: 422,
      headers: { 'x-request-id': 'request-error-1' },
      data: { code: 422, message: '包装费用计算失败', data: { bind_type: 1 } },
    });
    const job: any = { id: 9, response_snapshot: null };
    const payload = { goods: [{ file_id: 'file-2', bind_type: 1 }] };

    await expect(service.requestApi('POST', '/api/svip/cart/calc-price', payload, job))
      .rejects.toThrow('包装费用计算失败');

    expect(job.response_snapshot.providerResponses[0]).toMatchObject({
      requestBody: payload,
      httpStatus: 422,
      body: { code: 422, message: '包装费用计算失败', data: { bind_type: 1 } },
    });
  });

  it('does not query jobs or call the provider while the worker safety gate is disabled', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.workerRunning = false;
    service.configService = { get: jest.fn(() => 'false') };
    service.jobRepository = { createQueryBuilder: jest.fn() };

    await expect(service.processDueJobs()).resolves.toEqual({ scanned: 0, attempted: 0 });
    expect(service.jobRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('uses one indexed queue read and zero provider calls for an enabled but empty worker', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.workerRunning = false;
    service.logger = { debug: jest.fn(), log: jest.fn() };
    service.configService = { get: jest.fn(() => 'true') };
    const query = {
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]),
    };
    service.jobRepository = { createQueryBuilder: jest.fn(() => query) };
    service.getConfig = jest.fn();

    await expect(service.processDueJobs()).resolves.toEqual({ scanned: 0, attempted: 0 });
    expect(query.getMany).toHaveBeenCalledTimes(1);
    expect(service.getConfig).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('never reactivates a refund-reserved job from the manual action', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    const order = { id: 9, status: 1, pay_payload: { fulfillment_type: 'paper' } };
    const job = { id: 3, order_id: 9, status: CloudPrintJobStatus.REFUND_RESERVED };
    service.orderRepository = { findOne: jest.fn().mockResolvedValue(order) };
    service.jobRepository = {
      findOne: jest.fn().mockResolvedValue(job),
      save: jest.fn(),
    };
    service.assertPrintableOrder = jest.fn();
    service.syncOrderSnapshot = jest.fn();

    await expect(service.enqueuePaidOrder(9, 'manual', 7)).resolves.toBe(job);
    expect(service.jobRepository.save).not.toHaveBeenCalled();
    expect(service.syncOrderSnapshot).toHaveBeenCalledWith(order, job);
  });

  it('requires an exact high-entropy callback token', () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.configService = { get: jest.fn(() => 'callback-secret') };

    expect(() => service.verifyCallback('callback-secret')).not.toThrow();
    expect(() => service.verifyCallback('wrong-secret')).toThrow('云打印回调安全令牌无效');
  });

  it('keeps the default staple binding at the 160-page boundary', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    const payload = await buildPayload(service, 160);
    expect(payload.goods[0]).toMatchObject({ bind_type: 3, page_range: '1-160' });
    expect(payload.goods[0]).not.toHaveProperty('cover_media');
    expect(payload.goods[0]).not.toHaveProperty('cover_content');
  });

  it('upgrades a legacy saved binding default to staple without changing other settings', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    service.systemConfigRepository = {
      findOne: jest.fn().mockResolvedValue({ configValue: JSON.stringify({ bindType: 1, color: 3 }) }),
    };
    service.configService = { get: jest.fn(() => '') };
    await expect(service.getConfig()).resolves.toMatchObject({
      bindType: 3,
      color: 3,
      autoBindByPageCount: true,
      coverMedia: 1,
      coverColor: 5,
    });
  });

  it('automatically falls back to white leather-paper glue binding above 160 pages', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    const payload = await buildPayload(service, 161);
    expect(payload.goods[0]).toMatchObject({
      bind_type: 1,
      cover_media: 1,
      cover_color: 5,
      cover_content: { type: '1' },
      page_range: '1-161',
    });
  });

  it('passes configured glue cover options to the provider', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    const payload = await buildPayload(service, 80, {
      ...printConfig,
      bindType: 1,
      coverMedia: 2,
      coverColor: 3,
      coverContentType: 2,
      coverContentValue: '研刷通资料',
    });
    expect(payload.goods[0]).toMatchObject({
      bind_type: 1,
      cover_media: 2,
      cover_content: { type: '2', value: '研刷通资料' },
    });
    expect(payload.goods[0]).not.toHaveProperty('cover_color');
  });

  it('rejects files above the supplier glue-binding limit', async () => {
    const service = Object.create(CloudPrintService.prototype) as any;
    await expect(buildPayload(service, 601)).rejects.toThrow('文件 601 页不符合当前装订范围 8-600 页');
  });
});
