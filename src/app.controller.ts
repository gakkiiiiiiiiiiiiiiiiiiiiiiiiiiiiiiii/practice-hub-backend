import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { CommonResponseDto } from './common/dto/common-response.dto';

@ApiTags('健康检查')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: '根路径健康检查' })
  getHello() {
    return CommonResponseDto.success({
      message: '服务运行正常',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  }

  @Get('health')
  @ApiOperation({ summary: '健康检查' })
  health() {
    return CommonResponseDto.success({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }
}

