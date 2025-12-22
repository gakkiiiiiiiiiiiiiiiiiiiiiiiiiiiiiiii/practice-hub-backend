import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

/**
 * 可选的 JWT 认证守卫
 * 如果用户已登录，会设置 request.user
 * 如果用户未登录，不会抛出错误，request.user 为 undefined
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    // 如果有错误或用户不存在，不抛出异常，返回 undefined
    if (err || !user) {
      return undefined;
    }
    return user;
  }
}

