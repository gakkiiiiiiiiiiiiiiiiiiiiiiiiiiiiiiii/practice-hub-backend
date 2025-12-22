import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return '考研刷题小程序后端服务运行中...';
  }
}

