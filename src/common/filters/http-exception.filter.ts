import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response, Request } from 'express';
import { Repository } from 'typeorm';
import { SysErrorLog } from '../../database/entities/sys-error-log.entity';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    @InjectRepository(SysErrorLog)
    private readonly errorLogRepository: Repository<SysErrorLog>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = 500;

    // 记录异常详情
    this.logger.error('=== 异常过滤器捕获到错误 ===');
    this.logger.error('请求信息:', {
      method: request.method,
      url: request.url,
      path: request.path,
      query: request.query,
      body: request.body,
      headers: {
        authorization: request.headers.authorization ? 'Bearer ***' : '未提供',
      },
    });

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      this.logger.error('HTTP 异常:', {
        status,
        exceptionResponse,
        exceptionType: typeof exceptionResponse,
      });

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        code = (exceptionResponse as any).code || status;
        
        // 记录验证错误详情
        if ((exceptionResponse as any).message && Array.isArray((exceptionResponse as any).message)) {
          this.logger.error('验证错误详情:', (exceptionResponse as any).message);
        }
      }
    } else {
      // 非 HTTP 异常（普通错误）
      const error = exception as Error;
      this.logger.error('非 HTTP 异常:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      
      const errorCode = (error as any).code;
      const isConnectionError = error.message && (
        error.message.includes('ECONNRESET') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('Connection lost') ||
        errorCode === 'ECONNRESET' ||
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ETIMEDOUT' ||
        errorCode === 'PROTOCOL_CONNECTION_LOST'
      );
      const isQueryFailedError = error.name === 'QueryFailedError';

      if (isConnectionError) {
        message = '数据库连接异常，请稍后重试';
        code = HttpStatus.SERVICE_UNAVAILABLE;
        this.logger.warn('数据库连接错误，建议检查连接池配置和网络状态');
      } else if (isQueryFailedError) {
        message = '数据库执行异常，请检查表结构或迁移状态';
        code = HttpStatus.INTERNAL_SERVER_ERROR;
        this.logger.error('数据库查询错误详情:', {
          code: errorCode,
          errno: (error as any).errno,
          sqlMessage: (error as any).sqlMessage,
          query: (error as any).query,
        });
      } else {
        message = error.message || '服务器内部错误';
      }
    }

    this.logger.error('返回错误响应:', {
      code,
      msg: message,
      status,
    });
    this.logger.error('=== 异常处理完成 ===');

    void this.saveErrorLog(exception, request, status, code, message);

    response.status(status).json({
      code,
      msg: message,
      data: null,
    });
  }

  private async saveErrorLog(
    exception: unknown,
    request: Request,
    status: number,
    code: number,
    message: string,
  ) {
    try {
      const error = exception as Error & {
        code?: string;
        errno?: number;
        sqlMessage?: string;
        query?: string;
      };
      const user = (request as any).user || {};

      await this.errorLogRepository.save(
        this.errorLogRepository.create({
          method: request.method,
          url: request.originalUrl || request.url,
          status,
          code,
          message: this.truncate(message, 1000) || '服务器内部错误',
          errorName: this.truncate(error?.name, 100),
          stack: error?.stack || null,
          queryText: this.truncate(error?.query, 60000),
          sqlMessage: this.truncate(error?.sqlMessage, 1000),
          requestId: this.truncate(String(request.headers['x-request-id'] || ''), 100),
          ip: this.truncate(this.getClientIp(request), 100),
          userId: user.userId || user.id || null,
          userAgent: this.truncate(request.headers['user-agent'], 500),
          params: this.sanitizeRecord(request.params),
          query: this.sanitizeRecord(request.query),
          body: this.sanitizeRecord(request.body),
        }),
      );
    } catch (logError) {
      this.logger.error('保存错误日志失败:', logError);
    }
  }

  private getClientIp(request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0];
    }
    return forwardedFor || request.ip || request.socket?.remoteAddress || '';
  }

  private sanitizeRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const sanitized = this.sanitizeValue(value) as Record<string, unknown>;
    const json = JSON.stringify(sanitized);
    if (json.length <= 20000) {
      return sanitized;
    }
    return { _truncated: true, preview: json.slice(0, 20000) };
  }

  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    const sensitiveKeys = ['password', 'token', 'authorization', 'secret', 'cookie', 'openid', 'session'];
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((result, [key, val]) => {
      const lowerKey = key.toLowerCase();
      result[key] = sensitiveKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey))
        ? '***'
        : this.sanitizeValue(val);
      return result;
    }, {});
  }

  private truncate(value: unknown, maxLength: number) {
    if (value === undefined || value === null) {
      return null;
    }
    const text = String(value);
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }
}
