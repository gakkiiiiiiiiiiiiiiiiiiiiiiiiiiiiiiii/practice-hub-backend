import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AppUserSessionService } from '../app-user-session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private appUserSessionService: AppUserSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET', 'default_secret'),
    });
  }

  async validate(payload: any) {
    if (!payload) {
      throw new UnauthorizedException('无效的 Token');
    }

    if (payload.type === 'app') {
      if (payload.authMethod === 'password' && payload.sessionId) {
        const active = await this.appUserSessionService.isSessionActive(
          payload.sessionId,
          payload.userId,
        );
        if (!active) {
          throw new UnauthorizedException('登录已失效，请重新登录（账号已在其它设备登录或已退出）');
        }
      }
      return {
        userId: payload.userId,
        openid: payload.openid,
        role: payload.role,
        type: 'app',
        authMethod: payload.authMethod,
        sessionId: payload.sessionId,
      };
    }

    if (payload.type === 'admin') {
      return {
        adminId: payload.adminId,
        role: payload.role,
        type: 'admin',
      };
    }

    return payload;
  }
}
