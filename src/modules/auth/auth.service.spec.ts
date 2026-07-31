import { UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { AuthService } from './auth.service';

describe('AuthService 微信手机号快捷登录', () => {
	let service: AuthService;

	beforeEach(() => {
		const configService = {
			get: jest.fn((key: string) => {
				const config = {
					WECHAT_APPID: 'wx-test-appid',
					WECHAT_SECRET: 'test-secret',
				};
				return config[key];
			}),
		};

		service = new AuthService(
			null,
			null,
			null,
			configService as any,
			null,
			null,
			null,
			null,
		);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('使用稳定版 access_token 换取手机号', async () => {
		const post = jest
			.spyOn(axios, 'post')
			.mockResolvedValueOnce({ data: { access_token: 'stable-token', expires_in: 7200 } })
			.mockResolvedValueOnce({
				data: { errcode: 0, phone_info: { phoneNumber: '13800138000' } },
			});

		await expect((service as any).getPhoneNumberByCode('phone-code')).resolves.toBe('13800138000');
		expect(post).toHaveBeenNthCalledWith(
			1,
			'https://api.weixin.qq.com/cgi-bin/stable_token',
			expect.objectContaining({
				grant_type: 'client_credential',
				appid: 'wx-test-appid',
				secret: 'test-secret',
				force_refresh: false,
			}),
			expect.any(Object),
		);
		expect(post.mock.calls[1][0]).toBe(
			'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=stable-token',
		);
	});

	it('access_token 失效时重新获取最新凭据并重试一次', async () => {
		const post = jest
			.spyOn(axios, 'post')
			.mockResolvedValueOnce({ data: { access_token: 'expired-token', expires_in: 7200 } })
			.mockResolvedValueOnce({
				data: { errcode: 40001, errmsg: 'invalid credential, access_token is invalid or not latest' },
			})
			.mockResolvedValueOnce({ data: { access_token: 'refreshed-token', expires_in: 7200 } })
			.mockResolvedValueOnce({
				data: { errcode: 0, phone_info: { purePhoneNumber: '13900139000' } },
			});

		await expect((service as any).getPhoneNumberByCode('phone-code')).resolves.toBe('13900139000');
		expect(post).toHaveBeenNthCalledWith(
			3,
			'https://api.weixin.qq.com/cgi-bin/stable_token',
			expect.objectContaining({ force_refresh: false }),
			expect.any(Object),
		);
		expect(post.mock.calls[3][0]).toBe(
			'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=refreshed-token',
		);
	});

	it('刷新后 token 仍无效时不向客户端透传微信英文错误', async () => {
		jest
			.spyOn(axios, 'post')
			.mockResolvedValueOnce({ data: { access_token: 'expired-token', expires_in: 7200 } })
			.mockResolvedValueOnce({ data: { errcode: 42001, errmsg: 'access_token expired' } })
			.mockResolvedValueOnce({ data: { access_token: 'refreshed-token', expires_in: 7200 } })
			.mockResolvedValueOnce({ data: { errcode: 40014, errmsg: 'invalid access_token' } });

		await expect((service as any).getPhoneNumberByCode('phone-code')).rejects.toEqual(
			new UnauthorizedException('微信服务配置异常，请联系管理员'),
		);
	});
});
