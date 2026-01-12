import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, query } = req;
    const ip = req.ip || req.connection.remoteAddress;

    // 安全：不在日志中记录敏感信息（如密码、token等）
    const sanitizedQuery = { ...query };
    // 移除可能的敏感字段
    delete sanitizedQuery.password;
    delete sanitizedQuery.token;
    delete sanitizedQuery.code;

    this.logger.log(`${method} ${originalUrl} - IP: ${ip} - Query: ${JSON.stringify(sanitizedQuery)}`);

    res.on('finish', () => {
      const { statusCode } = res;
      this.logger.log(`${method} ${originalUrl} ${statusCode}`);
    });

    next();
  }
}

