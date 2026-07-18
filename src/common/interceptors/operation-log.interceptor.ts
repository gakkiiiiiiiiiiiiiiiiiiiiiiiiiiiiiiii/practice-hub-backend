import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysOperationLog } from '../../database/entities/sys-operation-log.entity';

const OPERATION_LOG_MARK = Symbol('operationLogRecorded');
const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|signature|access.?key|session)/i;

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);

  constructor(
    @InjectRepository(SysOperationLog)
    private operationLogRepository: Repository<SysOperationLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const method = String(request.method || '').toUpperCase();
    const path = this.normalizePath(request.originalUrl || request.url || '');

    // 管理后台的查询接口不属于操作审计，避免日志量失控。
    if (!MUTATION_METHODS.has(method) || !this.isAdminPath(path)) {
      return next.handle();
    }

    // 部分旧控制器仍显式挂载了本拦截器；全局启用后只记录一次。
    if (request[OPERATION_LOG_MARK]) {
      return next.handle();
    }
    request[OPERATION_LOG_MARK] = true;

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.persistLog(request, {
            method,
            path,
            statusCode:
              Number(response?.statusCode) || (method === 'POST' ? 201 : 200),
            durationMs: Date.now() - startedAt,
          });
        },
        error: (error) => {
          void this.persistLog(request, {
            method,
            path,
            statusCode: this.getErrorStatus(error),
            durationMs: Date.now() - startedAt,
            errorMessage: error?.message || '请求失败',
          });
        },
      }),
    );
  }

  private async persistLog(
    request: any,
    meta: {
      method: string;
      path: string;
      statusCode: number;
      durationMs: number;
      errorMessage?: string;
    },
  ): Promise<void> {
    try {
      const user = request.user || {};
      const targetId = this.toNumericId(
        request.params?.id ?? request.body?.id ?? request.query?.id,
      );
      const content = this.buildContent(request, meta);
      await this.operationLogRepository.save({
        admin_id: this.toNumericId(user.adminId ?? user.id) || 0,
        module: this.extractModule(meta.path),
        action: this.extractAction(meta.method, meta.path),
        target_id: targetId,
        content,
        ip: this.extractIp(request),
      });
    } catch (error: any) {
      this.logger.error(`操作日志记录失败: ${error?.message || error}`);
    }
  }

  private normalizePath(url: string): string {
    const value = String(url || '').split('?')[0] || '/';
    return value.startsWith('/') ? value : `/${value}`;
  }

  private isAdminPath(path: string): boolean {
    return (
      /^\/(?:api\/)?admin(?:\/|$)/.test(path) ||
      /^\/(?:api\/)?auth\/admin\/login$/.test(path)
    );
  }

  private extractModule(path: string): string {
    if (/\/(?:api\/)?auth\/admin\/login$/.test(path)) return 'auth';
    const parts = path.split('/').filter(Boolean);
    const adminIndex = parts.indexOf('admin');
    return (adminIndex >= 0 ? parts[adminIndex + 1] : '') || 'admin';
  }

  private extractAction(method: string, path: string): string {
    if (method === 'POST' && /\/auth\/admin\/login$/.test(path)) return 'login';
    if (method === 'POST') {
      if (path.includes('/import')) return 'import';
      if (path.includes('/generate')) return 'generate';
      if (path.includes('/issue')) return 'issue';
      return 'create';
    }
    if (method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'delete';
    return 'unknown';
  }

  private buildContent(request: any, meta: Record<string, any>): string {
    const payload = {
      ...meta,
      body: this.sanitize(request.body),
      params: this.sanitize(request.params),
      query: this.sanitize(request.query),
    };
    const serialized = JSON.stringify(payload);
    if (serialized.length <= 60_000) return serialized;
    return JSON.stringify({
      ...meta,
      body: `[请求内容过大，已省略；原始日志长度 ${serialized.length}]`,
      params: this.sanitize(request.params),
      query: this.sanitize(request.query),
      truncated: true,
    });
  }

  private sanitize(value: any, depth = 0): any {
    if (value === null || value === undefined) return value;
    if (depth >= 5) return '[已省略深层内容]';
    if (typeof value === 'string') {
      return value.length > 2_000
        ? `${value.slice(0, 2_000)}...[已截断]`
        : value;
    }
    if (typeof value !== 'object') return value;
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (Array.isArray(value)) {
      const items = value
        .slice(0, 50)
        .map((item) => this.sanitize(item, depth + 1));
      if (value.length > 50) items.push(`[其余 ${value.length - 50} 项已省略]`);
      return items;
    }
    return Object.entries(value).reduce<Record<string, any>>(
      (result, [key, item]) => {
        result[key] = SENSITIVE_KEY_PATTERN.test(key)
          ? '[REDACTED]'
          : this.sanitize(item, depth + 1);
        return result;
      },
      {},
    );
  }

  private getErrorStatus(error: any): number {
    const status =
      typeof error?.getStatus === 'function'
        ? error.getStatus()
        : error?.status;
    return Number(status) || 500;
  }

  private toNumericId(value: any): number | null {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private extractIp(request: any): string {
    const forwarded = request.headers?.['x-forwarded-for'];
    const candidate = Array.isArray(forwarded)
      ? forwarded[0]
      : String(forwarded || '').split(',')[0];
    return String(
      candidate || request.ip || request.socket?.remoteAddress || 'unknown',
    )
      .trim()
      .slice(0, 50);
  }
}
