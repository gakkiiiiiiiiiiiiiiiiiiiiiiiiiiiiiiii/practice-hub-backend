import { ForbiddenException } from '@nestjs/common';
import { ZhiyeAppGuard } from './zhiye-app.guard';

describe('ZhiyeAppGuard', () => {
  const context = (user: any) => ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;

  it('accepts only the configured Zhiye AppID namespace', () => {
    const guard = new ZhiyeAppGuard({
      get: jest.fn(() => 'wx-zhiye-app'),
    } as any);

    expect(guard.canActivate(context({
      type: 'app',
      openid: 'zhiye:wx-zhiye-app:openid-1',
    }))).toBe(true);
    expect(() => guard.canActivate(context({
      type: 'app',
      openid: 'practice-hub-openid',
    }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context({
      type: 'admin',
      openid: 'zhiye:wx-zhiye-app:openid-1',
    }))).toThrow(ForbiddenException);
  });

  it('fails closed while the independent Zhiye AppID is missing', () => {
    const guard = new ZhiyeAppGuard({ get: jest.fn(() => '') } as any);
    expect(() => guard.canActivate(context({
      type: 'app',
      openid: 'zhiye:legacy-app:openid-1',
    }))).toThrow('知页小程序 AppID 尚未配置');
  });
});
