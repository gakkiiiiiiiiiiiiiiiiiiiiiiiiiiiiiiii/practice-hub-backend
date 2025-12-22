import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
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
    
    // 根据 token 类型返回不同的用户信息
    if (payload.type === 'app') {
      return {
        userId: payload.userId,
        openid: payload.openid,
        type: 'app',
      };
    } else if (payload.type === 'admin') {
      return {
        adminId: payload.adminId,
        role: payload.role,
        type: 'admin',
      };
    }
    
    return payload;
  }
}

