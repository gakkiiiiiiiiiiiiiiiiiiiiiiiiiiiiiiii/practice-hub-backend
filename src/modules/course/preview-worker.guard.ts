import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class PreviewWorkerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredToken = String(
      this.configService.get<string>('PREVIEW_WORKER_TOKEN') || '',
    ).trim();
    if (!configuredToken) {
      throw new ServiceUnavailableException('预览工作节点尚未启用');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedToken = String(request.header('x-preview-worker-token') || '').trim();
    const expected = Buffer.from(configuredToken);
    const actual = Buffer.from(providedToken);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('预览工作节点凭证无效');
    }
    return true;
  }
}
