import {
	Controller,
	Get,
	Patch,
	Post,
	Body,
	Param,
	Query,
	UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DistributorService } from './distributor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { UpdateDistributorStatusDto } from './dto/update-distributor-status.dto';
import { UpdateDistributionConfigDto } from './dto/update-distribution-config.dto';
import { GetDistributorListDto } from './dto/get-distributor-list.dto';

@ApiTags('后台-分销管理')
@Controller('admin/distributor')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminDistributorController {
	constructor(private readonly distributorService: DistributorService) {}

	// 静态路由必须放在动态路由之前
	@Get('list')
	@ApiOperation({ summary: '获取分销用户列表' })
	async getDistributorList(@Query() dto: GetDistributorListDto) {
		const result = await this.distributorService.getDistributorList(
			dto.status,
			dto.page || 1,
			dto.pageSize || 20,
		);
		return CommonResponseDto.success(result);
	}

	@Get('config')
	@ApiOperation({ summary: '获取分销配置' })
	async getDistributionConfig() {
		const result = await this.distributorService.getDistributionConfig();
		return CommonResponseDto.success(result);
	}

	@Post('config')
	@ApiOperation({ summary: '更新分销配置' })
	async updateDistributionConfig(@Body() dto: UpdateDistributionConfigDto) {
		const result = await this.distributorService.updateDistributionConfig(dto);
		return CommonResponseDto.success(result);
	}

	@Get('stats')
	@ApiOperation({ summary: '获取分销统计数据（全部）' })
	async getDistributionStats() {
		const result = await this.distributorService.getAdminStats();
		return CommonResponseDto.success(result);
	}

	// 动态路由放在最后
	@Patch(':id/status')
	@ApiOperation({ summary: '更新分销用户状态' })
	async updateDistributorStatus(
		@Param('id') id: number,
		@Body() dto: UpdateDistributorStatusDto,
	) {
		const result = await this.distributorService.updateDistributorStatus(id, dto);
		return CommonResponseDto.success(result);
	}
}

