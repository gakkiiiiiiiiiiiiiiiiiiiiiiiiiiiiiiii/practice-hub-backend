import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HomeService } from './home.service';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('首页')
@Controller('app/home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('config')
  @ApiOperation({ summary: '获取首页配置' })
  async getHomeConfig() {
    const result = await this.homeService.getHomeConfig();
    return CommonResponseDto.success(result);
  }

  @Get('quote')
  @ApiOperation({ summary: '获取每日励志语录' })
  async getDailyQuote() {
    const result = await this.homeService.getDailyQuote();
    return CommonResponseDto.success(result);
  }
}

