import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysOperationLog } from '../../database/entities/sys-operation-log.entity';

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(SysOperationLog)
    private operationLogRepository: Repository<SysOperationLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, params, query, user, ip } = request;

    // 只记录增删改操作
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next.handle();
    }

    const module = this.extractModule(url);
    const action = this.extractAction(method, url);
    const targetId = params.id || body.id || query.id || null;
    const content = JSON.stringify({ body, params, query });

    return next.handle().pipe(
      tap(async () => {
        try {
          await this.operationLogRepository.save({
            admin_id: user?.id || 0,
            module,
            action,
            target_id: targetId,
            content,
            ip: ip || 'unknown',
          });
        } catch (error) {
          console.error('操作日志记录失败:', error);
        }
      }),
    );
  }

  private extractModule(url: string): string {
    const parts = url.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'admin') {
      return parts[2] || 'unknown';
    }
    return 'unknown';
  }

  private extractAction(method: string, url: string): string {
    if (method === 'POST') {
      if (url.includes('/import')) return 'import';
      if (url.includes('/generate')) return 'generate';
      return 'create';
    }
    if (method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'delete';
    return 'unknown';
  }
}

