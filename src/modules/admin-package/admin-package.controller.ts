import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { PackageService } from '../package/package.service';
import { CreatePackageSectionDto } from './dto/create-package-section.dto';

@ApiTags('套餐管理')
@Controller('admin/packages')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN)
export class AdminPackageController {
	constructor(private readonly packageService: PackageService) {}

	@Get()
	@ApiOperation({ summary: '套餐列表' })
	async list() {
		return CommonResponseDto.success(await this.packageService.adminListSections());
	}

	@Get(':id')
	@ApiOperation({ summary: '套餐详情' })
	async detail(@Param('id', ParseIntPipe) id: number) {
		return CommonResponseDto.success(await this.packageService.adminGetSection(id));
	}

	@Post()
	@ApiOperation({ summary: '创建套餐' })
	async create(@Body() dto: CreatePackageSectionDto) {
		return CommonResponseDto.success(await this.packageService.adminCreateSection(dto));
	}

	@Put(':id')
	@ApiOperation({ summary: '更新套餐' })
	async update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreatePackageSectionDto) {
		return CommonResponseDto.success(await this.packageService.adminUpdateSection(id, dto));
	}

	@Delete(':id')
	@ApiOperation({ summary: '删除套餐' })
	async remove(@Param('id', ParseIntPipe) id: number) {
		return CommonResponseDto.success(await this.packageService.adminDeleteSection(id));
	}
}
