import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { DistributorService } from './distributor.service';

describe('DistributorService short links', () => {
	const createService = () => {
		const service = Object.create(DistributorService.prototype) as any;
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({});
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 1, status: 1, distributor_code: 'D123', short_link: null }),
			save: jest.fn().mockImplementation(async (value) => value),
		};
		service.configService = { get: jest.fn((key) => ({ WECHAT_APPID: 'test-app', WECHAT_SECRET: 'test-secret' })[key]) };
		service.logger = { warn: jest.fn(), error: jest.fn() };
		jest.spyOn(axios, 'get').mockResolvedValue({ data: { access_token: 'test-token' } });
		jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { errcode: 0, link: '#小程序://测试/test' } });
		return service;
	};

	afterEach(() => jest.restoreAllMocks());

	it('maps the WeChat link field and caches the result', async () => {
		const service = createService();
		await expect(service.generateShortLink(1)).resolves.toEqual({ short_link: '#小程序://测试/test' });
		await expect(service.generateShortLink(1)).resolves.toEqual({ short_link: '#小程序://测试/test' });
		expect(axios.get).toHaveBeenCalledTimes(1);
		expect(axios.post).toHaveBeenCalledTimes(1);
		expect(axios.post).toHaveBeenCalledWith('https://api.weixin.qq.com/wxa/genwxashortlink', expect.anything(),
			expect.objectContaining({ params: { access_token: 'test-token' }, proxy: false, maxRedirects: 0 }));
	});

	it('uses the internal HTTP proxy only in a cloud-run environment', async () => {
		const service = createService();
		service.configService.get.mockImplementation((key) => ({ WECHAT_APPID: 'test-app', WECHAT_SECRET: 'test-secret', CBR_ENV_ID: 'cloud-test' })[key]);
		await expect(service.generateShortLink(1)).resolves.toEqual({ short_link: '#小程序://测试/test' });
		expect(axios.post).toHaveBeenCalledWith('http://api.weixin.qq.com/wxa/genwxashortlink', expect.anything(),
			expect.objectContaining({ params: { access_token: 'test-token' }, proxy: false, maxRedirects: 0 }));
	});

	it('identifies a token whitelist failure before attempting to create a link', async () => {
		const service = createService();
		jest.mocked(axios.get).mockRejectedValueOnce({
			message: 'Request failed with status code 502',
			response: { status: 502, data: { error_message: 'URL不在白名单内，请配置微信令牌' } },
		});
		await expect(service.generateShortLink(1)).rejects.toThrow('获取微信凭证失败：微信云托管未放行此微信接口');
		expect(axios.post).not.toHaveBeenCalled();
	});

	it('preserves the cloud proxy error_message on a short-link HTTP failure', async () => {
		const service = createService();
		jest.mocked(axios.post).mockResolvedValueOnce({ status: 502, data: { error_message: 'URL不在白名单内，请配置微信令牌' } });
		await expect(service.generateShortLink(1)).rejects.toThrow('URL不在白名单内');
		expect(service.distributorRepository.save).not.toHaveBeenCalled();
	});

	it('exposes a safe transport code without leaking a request token', async () => {
		const service = createService();
		jest.mocked(axios.post).mockRejectedValueOnce({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'secret=test-secret access_token=test-token' });
		await expect(service.generateShortLink(1)).rejects.toEqual(new BadRequestException('请求微信短链接失败：UNABLE_TO_VERIFY_LEAF_SIGNATURE'));
		expect(JSON.stringify(service.logger.error.mock.calls)).not.toContain('test-token');
	});

	it('identifies a database save failure without disclosing database details', async () => {
		const service = createService();
		service.distributorRepository.save.mockRejectedValueOnce({ code: 'ER_ACCESS_DENIED_ERROR', message: 'password=test-secret' });
		await expect(service.generateShortLink(1)).rejects.toEqual(new BadRequestException('保存分享链接失败：ER_ACCESS_DENIED_ERROR'));
		expect(JSON.stringify(service.logger.error.mock.calls)).not.toContain('test-secret');
	});
});
