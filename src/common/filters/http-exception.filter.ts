import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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
      
      // 处理数据库连接错误
      if (error.message && (
        error.message.includes('ECONNRESET') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('Connection lost') ||
        error.name === 'QueryFailedError'
      )) {
        message = '数据库连接异常，请稍后重试';
        code = HttpStatus.SERVICE_UNAVAILABLE;
        this.logger.warn('数据库连接错误，建议检查连接池配置和网络状态');
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

    response.status(status).json({
      code,
      msg: message,
      data: null,
    });
  }
}

