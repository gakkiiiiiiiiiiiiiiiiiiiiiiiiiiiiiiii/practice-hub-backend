import { Controller, Post, Get, Body, UseGuards, Query, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DistributorService } from './distributor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { ApplyDistributorDto } from './dto/apply-distributor.dto';
import { UpdateDistributorStatusDto } from './dto/update-distributor-status.dto';
import { UpdateDistributionConfigDto } from './dto/update-distribution-config.dto';

@ApiTags('分销')
@Controller('app/distributor')
export class DistributorController {
	constructor(private readonly distributorService: DistributorService) {}

	@Post('apply')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '申请成为分销用户' })
	async applyDistributor(@CurrentUser() user: any, @Body() dto: ApplyDistributorDto) {
		const result = await this.distributorService.applyDistributor(user.userId);
		return CommonResponseDto.success(result);
	}

	@Get('info')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取分销用户信息' })
	async getDistributorInfo(@CurrentUser() user: any) {
		const result = await this.distributorService.getDistributorInfo(user.userId);
		return CommonResponseDto.success(result);
	}

	@Get('qr-code')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '生成专属小程序二维码' })
	async generateQRCode(@CurrentUser() user: any) {
		const result = await this.distributorService.generateQRCode(user.userId);
		return CommonResponseDto.success(result);
	}

	@Get('stats')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取分销统计数据' })
	async getDistributorStats(@CurrentUser() user: any) {
		const result = await this.distributorService.getDistributorStats(user.userId);
		return CommonResponseDto.success(result);
	}

	@Post('bind')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '绑定上级分销商（通过分销商编号）' })
	async bindDistributionRelation(@CurrentUser() user: any, @Body('distributor_code') distributorCode: string) {
		const result = await this.distributorService.bindDistributionRelation(user.userId, distributorCode);
		return CommonResponseDto.success(result);
	}

	@Post('buy-codes')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '购买激活码（分销商）' })
	async buyCodes(@CurrentUser() user: any, @Body() body: { course_id: number; count: number }) {
		const result = await this.distributorService.buyActivationCodes(user.userId, body.course_id, body.count);
		return CommonResponseDto.success(result);
	}

	@Get('codes')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取分销商购买的激活码列表' })
	async getDistributorCodes(
		@CurrentUser() user: any,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
		@Query('batch_id') batchId?: string,
		@Query('status') status?: string,
	) {
		// 解析并校验分页与状态，避免 NaN 传入查询
		const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
		const pageSizeNum = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
		let statusNum: number | undefined;
		if (status !== undefined && status !== null && status !== '') {
			const parsed = parseInt(String(status), 10);
			if (!Number.isNaN(parsed) && parsed >= 0) {
				statusNum = parsed;
			}
		}
		const result = await this.distributorService.getDistributorCodes(
			user.userId,
			pageNum,
			pageSizeNum,
			batchId,
			statusNum,
		);
		return CommonResponseDto.success(result);
	}
}
