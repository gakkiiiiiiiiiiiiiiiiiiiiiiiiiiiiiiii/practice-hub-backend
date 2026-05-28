import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { PackageService } from '../package/package.service';
import { VirtualPayGoodsService } from '../order/virtual-pay-goods.service';
import { CreatePackageSectionDto } from './dto/create-package-section.dto';

@ApiTags('套餐管理')
@Controller('admin/packages')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN)
export class AdminPackageController {
	constructor(
		private readonly packageService: PackageService,
		private readonly virtualPayGoodsService: VirtualPayGoodsService,
	) {}

	private buildSaveResult(section: any) {
		const hasPayablePlan = Array.isArray(section?.plans)
			&& section.plans.some((plan: any) => (plan.status ?? 1) === 1 && Number(plan.price || 0) > 0);
		if (!hasPayablePlan || !this.virtualPayGoodsService.isAutoUploadEnabled()) {
			return section;
		}
		return {
			...section,
			virtual_pay_goods_sync: this.virtualPayGoodsService.buildAdminPriceSyncNotice(),
		};
	}

	private syncPackageVirtualGoods(section: any, force = true) {
		if (!section?.plans?.length) return;
		for (const plan of section.plans) {
			if ((plan.status ?? 1) !== 1 || Number(plan.price || 0) <= 0) continue;
			this.virtualPayGoodsService.scheduleSyncPackagePlanGoods(
				{ id: section.id, name: section.name },
				{
					id: plan.id,
					name: plan.name,
					price: plan.price,
					status: plan.status,
				},
				{ force },
			);
		}
	}

	@Get()
	@ApiOperation({ summary: '套餐列表' })
	async list() {
		return CommonResponseDto.success(await this.packageService.adminListSections());
	}

	@Post('virtual-pay-goods/sync-all')
	@ApiOperation({ summary: '同步全部套餐规格的微信虚拟道具价格' })
	async syncAllPackageVirtualPayGoods() {
		const counts = await this.virtualPayGoodsService.countVirtualPaySyncTargets();
		this.virtualPayGoodsService.scheduleSyncAllPackagePlanGoods({ force: true });
		return CommonResponseDto.success(
			this.virtualPayGoodsService.buildAdminBatchSyncResponse({
				courses: 0,
				packages: counts.packages,
				total: counts.packages,
			}),
		);
	}

	@Get(':id')
	@ApiOperation({ summary: '套餐详情' })
	async detail(@Param('id', ParseIntPipe) id: number) {
		return CommonResponseDto.success(await this.packageService.adminGetSection(id));
	}

	@Post()
	@ApiOperation({ summary: '创建套餐' })
	async create(@Body() dto: CreatePackageSectionDto) {
		const section = await this.packageService.adminCreateSection(dto);
		this.syncPackageVirtualGoods(section);
		return CommonResponseDto.success(this.buildSaveResult(section));
	}

	@Put(':id')
	@ApiOperation({ summary: '更新套餐' })
	async update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreatePackageSectionDto) {
		const section = await this.packageService.adminUpdateSection(id, dto);
		this.syncPackageVirtualGoods(section);
		return CommonResponseDto.success(this.buildSaveResult(section));
	}

	@Delete(':id')
	@ApiOperation({ summary: '删除套餐' })
	async remove(@Param('id', ParseIntPipe) id: number) {
		return CommonResponseDto.success(await this.packageService.adminDeleteSection(id));
	}
}
