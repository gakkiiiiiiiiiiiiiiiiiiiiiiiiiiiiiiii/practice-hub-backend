import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BannerService } from './banner.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { GetBannerListDto } from './dto/get-banner-list.dto';

@ApiTags('轮播图管理')
@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN) // 超级管理员和题库管理员可以管理轮播图
export class BannerController {
	constructor(private readonly bannerService: BannerService) {}

	@Get()
	@ApiOperation({ summary: '获取轮播图列表（管理端）' })
	async getBannerList(@Query() dto: GetBannerListDto) {
		const result = await this.bannerService.getBannerList(dto);
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@ApiOperation({ summary: '获取轮播图详情' })
	async getBannerDetail(@Param('id') id: number) {
		const result = await this.bannerService.getBannerDetail(+id);
		return CommonResponseDto.success(result);
	}

	@Post()
	@ApiOperation({ summary: '创建轮播图' })
	async createBanner(@Body() dto: CreateBannerDto) {
		const result = await this.bannerService.createBanner(dto);
		return CommonResponseDto.success(result);
	}

	@Put(':id')
	@ApiOperation({ summary: '更新轮播图' })
	async updateBanner(@Param('id') id: number, @Body() dto: UpdateBannerDto) {
		const result = await this.bannerService.updateBanner(+id, dto);
		return CommonResponseDto.success(result);
	}

	@Delete(':id')
	@ApiOperation({ summary: '删除轮播图' })
	async deleteBanner(@Param('id') id: number) {
		const result = await this.bannerService.deleteBanner(+id);
		return CommonResponseDto.success(result);
	}

	@Put('sort/update')
	@ApiOperation({ summary: '批量更新排序' })
	async updateSortOrder(@Body() body: { ids: number[] }) {
		const result = await this.bannerService.updateSortOrder(body.ids);
		return CommonResponseDto.success(result);
	}
}
