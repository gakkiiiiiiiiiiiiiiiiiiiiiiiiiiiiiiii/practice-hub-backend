import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PageRouteService } from './page-route.service';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { SyncPageRoutesDto } from './dto/sync-page-routes.dto';

@ApiTags('小程序-页面路由')
@Controller('app/page-routes')
export class AppPageRouteController {
	constructor(private readonly pageRouteService: PageRouteService) {}

	@Post('sync')
	@ApiOperation({ summary: '同步页面路由（小程序端调用，无需权限）' })
	async syncPageRoutes(@Body() dto: SyncPageRoutesDto) {
		const result = await this.pageRouteService.syncPageRoutes(dto);
		return CommonResponseDto.success(result);
	}
}
