import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BannerService } from './banner.service';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('小程序-首页')
@Controller('app/banners')
export class AppBannerController {
	constructor(private readonly bannerService: BannerService) {}

	@Get()
	@ApiOperation({ summary: '获取启用的轮播图列表（小程序端）' })
	async getActiveBanners() {
		const result = await this.bannerService.getActiveBanners();
		return CommonResponseDto.success(result);
	}
}
