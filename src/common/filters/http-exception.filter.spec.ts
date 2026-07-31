import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter 日志脱敏', () => {
	it('隐藏微信登录和手机号授权的一次性凭据', () => {
		const filter = new HttpExceptionFilter(null);
		const sanitized = (filter as any).sanitizeRecord({
			loginCode: 'login-code-value',
			phoneCode: 'phone-code-value',
			code: 'generic-code-value',
			nested: {
				js_code: 'js-code-value',
				verificationCode: 'verification-code-value',
				nickname: '测试用户',
			},
		});

		expect(sanitized).toEqual({
			loginCode: '***',
			phoneCode: '***',
			code: '***',
			nested: {
				js_code: '***',
				verificationCode: '***',
				nickname: '测试用户',
			},
		});
	});
});
