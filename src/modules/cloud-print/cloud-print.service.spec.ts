import axios from 'axios';
import * as crypto from 'crypto';
import { CloudPrintService } from './cloud-print.service';
import { CloudPrintJobStatus } from '../../database/entities/cloud-print-job.entity';

jest.mock('axios');

describe('CloudPrintService', () => {
  afterEach(() => jest.resetAllMocks());

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
});
