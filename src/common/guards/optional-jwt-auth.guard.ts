import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

/**
 * 可选的 JWT 认证守卫
 * 如果用户已登录，会设置 request.user
 * 如果用户未登录，不会抛出错误，request.user 为 undefined
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(OptionalJwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace('Bearer ', '') || null;

    // 尝试激活，如果失败（token 无效或不存在），允许继续访问
    return super.canActivate(context).catch((error) => {
      // token 无效时，允许访问，但 request.user 将为 undefined
      if (token) {
        this.logger.debug(`Token 验证失败，但允许继续访问 - 路径: ${request.path}`, {
          error: error.message,
          tokenPrefix: token.substring(0, 20) + '...',
        });
      } else {
        this.logger.debug(`未提供 Token，允许继续访问 - 路径: ${request.path}`);
      }
      return true;
    });
  }

  handleRequest(err: any, user: any, info: any) {
    // 如果有错误或用户不存在，不抛出异常，返回 undefined
    if (err || !user) {
      if (err) {
        this.logger.debug(`JWT 验证错误: ${err.message}`, {
          info: info?.message || info,
        });
      } else if (info) {
        this.logger.debug(`JWT 验证信息: ${info.message || info}`);
      }
      return undefined;
    }
    
    this.logger.debug(`JWT 验证成功 - 用户ID: ${user.userId || user.adminId}, 类型: ${user.type}`);
    return user;
  }
}

