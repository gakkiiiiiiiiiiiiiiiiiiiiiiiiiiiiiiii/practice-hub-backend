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
	UseFilters,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminCourseService } from './admin-course.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpdateRecommendationsDto } from '../course/dto/update-recommendations.dto';

@ApiTags('管理后台-课程管理')
@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@UseFilters(HttpExceptionFilter)
@ApiBearerAuth()
export class AdminCourseController {
	constructor(private readonly adminCourseService: AdminCourseService) {}

	@Post()
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '新增课程' })
	async createCourse(@Body() dto: CreateCourseDto) {
		const result = await this.adminCourseService.saveCourse(dto);
		return CommonResponseDto.success(result);
	}

	@Put(':id')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '编辑课程' })
	async updateCourse(@Param('id') id: number, @Body() dto: UpdateCourseDto) {
		const result = await this.adminCourseService.saveCourse(dto, +id);
		return CommonResponseDto.success(result);
	}

	@Get()
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN, AdminRole.AGENT)
	@ApiOperation({ summary: '获取课程列表' })
	async getCourseList() {
		const result = await this.adminCourseService.getCourseList();
		return CommonResponseDto.success(result);
	}

	// 注意：具体的路由（recommendations）必须放在动态路由（:id）之前
	// 否则 /admin/courses/recommendations 会被匹配为 /admin/courses/:id，其中 id = 'recommendations'
	@Get('recommendations')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取相关推荐配置' })
	async getRecommendations(@Query('courseId') courseId?: string | number) {
		// 处理 courseId：如果为空、undefined 或无效，则传递 null
		let parsedCourseId: number | null = null;

		// 调试日志
		console.log('[getRecommendations] 原始 courseId:', courseId, '类型:', typeof courseId);

		if (courseId !== undefined && courseId !== null && courseId !== '') {
			const numId = typeof courseId === 'string' ? parseInt(courseId, 10) : Number(courseId);
			console.log('[getRecommendations] 转换后的 numId:', numId, 'isNaN:', isNaN(numId));

			if (!isNaN(numId) && Number.isFinite(numId) && numId > 0) {
				parsedCourseId = numId;
			}
		}

		console.log('[getRecommendations] 最终 parsedCourseId:', parsedCourseId);
		const result = await this.adminCourseService.getRecommendations(parsedCourseId);
		return CommonResponseDto.success(result);
	}

	@Put('recommendations')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '更新相关推荐配置' })
	async updateRecommendations(@Body() dto: UpdateRecommendationsDto) {
		const result = await this.adminCourseService.updateRecommendations(dto);
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN, AdminRole.AGENT)
	@ApiOperation({ summary: '获取课程详情' })
	async getCourseDetail(@Param('id') id: number) {
		const result = await this.adminCourseService.getCourseDetail(+id);
		return CommonResponseDto.success(result);
	}

	@Delete(':id')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '删除课程' })
	async deleteCourse(@Param('id') id: number) {
		const result = await this.adminCourseService.deleteCourse(+id);
		return CommonResponseDto.success(result);
	}
}
