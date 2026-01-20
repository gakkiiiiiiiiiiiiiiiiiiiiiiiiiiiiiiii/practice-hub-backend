import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Body,
	Param,
	Query,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { AdminCourseCategoryService } from './admin-course-category.service';
import { CreateCourseCategoryDto } from './dto/create-course-category.dto';
import { UpdateCourseCategoryDto } from './dto/update-course-category.dto';

@ApiTags('题库分类管理')
@Controller('admin/course-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class AdminCourseCategoryController {
	constructor(private readonly adminCourseCategoryService: AdminCourseCategoryService) {}

	@Get()
	@ApiOperation({ summary: '获取题库分类树' })
	async getCategoryTree(@Query('status') status?: number) {
		const parsedStatus = status !== undefined ? Number(status) : undefined;
		const result = await this.adminCourseCategoryService.getCategoryTree(
			Number.isFinite(parsedStatus) ? parsedStatus : undefined,
		);
		return CommonResponseDto.success(result);
	}

	@Post()
	@ApiOperation({ summary: '创建题库分类' })
	async createCategory(@Body() dto: CreateCourseCategoryDto) {
		const result = await this.adminCourseCategoryService.createCategory(dto);
		return CommonResponseDto.success(result);
	}

	@Put(':id')
	@ApiOperation({ summary: '更新题库分类' })
	async updateCategory(@Param('id') id: number, @Body() dto: UpdateCourseCategoryDto) {
		const result = await this.adminCourseCategoryService.updateCategory(+id, dto);
		return CommonResponseDto.success(result);
	}

	@Delete(':id')
	@ApiOperation({ summary: '删除题库分类' })
	async deleteCategory(@Param('id') id: number) {
		const result = await this.adminCourseCategoryService.deleteCategory(+id);
		return CommonResponseDto.success(result);
	}
}
