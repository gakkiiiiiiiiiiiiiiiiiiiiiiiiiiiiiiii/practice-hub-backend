import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PageRouteService } from './page-route.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { SyncPageRoutesDto } from './dto/sync-page-routes.dto';
import { GetPageRoutesDto } from './dto/get-page-routes.dto';

@ApiTags('页面路由管理')
@Controller('admin/page-routes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN) // 超级管理员和题库管理员可以管理页面路由
export class PageRouteController {
	constructor(private readonly pageRouteService: PageRouteService) {}

	@Post('sync')
	@ApiOperation({ summary: '同步页面路由（小程序端调用）' })
	async syncPageRoutes(@Body() dto: SyncPageRoutesDto) {
		const result = await this.pageRouteService.syncPageRoutes(dto);
		return CommonResponseDto.success(result);
	}

	@Get()
	@ApiOperation({ summary: '获取页面路由列表' })
	async getPageRoutes(@Query() dto: GetPageRoutesDto) {
		const result = await this.pageRouteService.getPageRoutes(dto);
		return CommonResponseDto.success(result);
	}
}
