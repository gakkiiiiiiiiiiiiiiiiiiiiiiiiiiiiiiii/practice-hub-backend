import axios from 'axios';
import { XpayService } from './xpay.service';

describe('XpayService WeChat transport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps TLS verification enabled and bypasses environment proxies', async () => {
    const service = new XpayService({ get: jest.fn() } as any);
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { errcode: 0 } });

    await (service as any).requestWechatPublicApi(
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      '{}',
      {},
    );

    expect(post).toHaveBeenCalledWith(
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      '{}',
      expect.objectContaining({
        proxy: false,
      }),
    );
    expect(post.mock.calls[0][2]).not.toHaveProperty('httpsAgent');
  });
});
