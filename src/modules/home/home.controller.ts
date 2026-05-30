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

  @Get('faqs')
  @ApiOperation({ summary: '获取常见问题列表' })
  async getFaqs() {
    const result = await this.homeService.getFaqs();
    return CommonResponseDto.success(result);
  }

  @Get('version')
  @ApiOperation({ summary: '获取小程序最低版本要求' })
  async getMiniappVersion() {
    const result = await this.homeService.getMiniappVersion();
    return CommonResponseDto.success(result);
  }
}
