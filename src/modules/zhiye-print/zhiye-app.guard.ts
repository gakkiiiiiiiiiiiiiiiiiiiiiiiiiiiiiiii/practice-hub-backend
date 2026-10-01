import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Restricts Zhiye resources to tokens issued from the independent Zhiye AppID. */
@Injectable()
export class ZhiyeAppGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest()?.user;
    const openid = String(user?.openid || '');
    const appid = String(this.configService.get('ZHIYE_WECHAT_APPID') || '').trim();
    if (!appid) throw new ForbiddenException('知页小程序 AppID 尚未配置');
    const expectedPrefix = `zhiye:${appid}:`;
    if (user?.type !== 'app' || !openid.startsWith(expectedPrefix)) {
      throw new ForbiddenException('当前账号不是知页小程序账号');
    }
    return true;
  }
}
