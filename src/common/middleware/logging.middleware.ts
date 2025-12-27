import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, query, body } = req;
    const userAgent = req.get('user-agent') || '';
    const ip = req.ip || req.connection.remoteAddress;

    this.logger.log(`${method} ${originalUrl} - IP: ${ip} - Query: ${JSON.stringify(query)}`);

    res.on('finish', () => {
      const { statusCode } = res;
      this.logger.log(`${method} ${originalUrl} ${statusCode}`);
    });

    next();
  }
}

