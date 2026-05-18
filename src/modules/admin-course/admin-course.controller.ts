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
	BadRequestException,
	ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { BatchDeleteCoursesDto } from './dto/batch-delete-courses.dto';
import { BatchUpdateStatusDto } from './dto/batch-update-status.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';

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
	async getCourseList(
		@Query('name') name?: string,
		@Query('subject') subject?: string,
		@Query('category') category?: string,
		@Query('subCategory') subCategory?: string,
	) {
		const result = await this.adminCourseService.getCourseList({
			name,
			subject,
			category,
			subCategory,
		});
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

		if (courseId !== undefined && courseId !== null && courseId !== '') {
			const numId = typeof courseId === 'string' ? parseInt(courseId, 10) : Number(courseId);

			if (!isNaN(numId) && Number.isFinite(numId) && numId > 0) {
				parsedCourseId = numId;
			}
		}

		const result = await this.adminCourseService.getRecommendations(parsedCourseId);
		return CommonResponseDto.success(result);
	}

	@Put('recommendations')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '更新相关推荐配置' })
	@ApiBody({ type: UpdateRecommendationsDto })
	async updateRecommendations(@Body() body: Record<string, unknown>) {
		const dto: UpdateRecommendationsDto = {
			courseId: this.parseOptionalCourseId(body?.courseId),
			recommendedCourseIds: this.parseRecommendedCourseIds(body?.recommendedCourseIds),
		};
		const result = await this.adminCourseService.updateRecommendations(dto);
		return CommonResponseDto.success(result);
	}

	@Get('preview-cache/progress')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '查询课程文件图片预览缓存生成进度' })
	async getPreviewCacheProgress() {
		const result = await this.adminCourseService.getPreviewCacheProgress();
		return CommonResponseDto.success(result);
	}

	@Post('preview-cache/interrupt')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '中断正在生成的课程文件图片预览缓存任务' })
	async interruptPreviewCacheTask() {
		const result = await this.adminCourseService.interruptPreviewCacheTask();
		return CommonResponseDto.success(result);
	}

	@Post('preview-cache/retry-failed')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '重新生成失败课程的文件图片预览缓存' })
	async retryFailedPreviewCacheTask(@Body() body: { taskId?: number } = {}) {
		const taskId = body?.taskId === undefined || body?.taskId === null ? undefined : Number(body.taskId);
		if (taskId !== undefined && (!Number.isInteger(taskId) || taskId <= 0)) {
			throw new BadRequestException('taskId 必须是大于 0 的整数');
		}
		const result = await this.adminCourseService.warmupFailedPreviewCaches(taskId);
		return CommonResponseDto.success(result);
	}

	private parseOptionalCourseId(value: unknown): number | null {
		if (value === undefined || value === null || value === '') {
			return null;
		}

		const courseId = Number(value);
		if (!Number.isInteger(courseId) || courseId <= 0) {
			throw new BadRequestException('courseId 必须是大于 0 的整数');
		}

		return courseId;
	}

	private parseRecommendedCourseIds(value: unknown): number[] {
		if (!Array.isArray(value)) {
			throw new BadRequestException('recommendedCourseIds 必须是数组');
		}

		const recommendedCourseIds = Array.from(new Set(value.map((item) => Number(item))));
		if (recommendedCourseIds.length === 0) {
			throw new BadRequestException('至少选择一个推荐课程');
		}

		if (recommendedCourseIds.some((id) => !Number.isInteger(id) || id <= 0)) {
			throw new BadRequestException('推荐课程ID必须是大于 0 的整数');
		}

		return recommendedCourseIds;
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

	@Post('batch-delete')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '批量删除课程' })
	async batchDeleteCourses(@Body() dto: BatchDeleteCoursesDto) {
		const result = await this.adminCourseService.batchDeleteCourses(dto);
		return CommonResponseDto.success(result);
	}

	@Post('batch-update-status')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '批量更新课程状态（启用/禁用）' })
	async batchUpdateStatus(@Body() dto: BatchUpdateStatusDto) {
		const result = await this.adminCourseService.batchUpdateStatus(dto);
		return CommonResponseDto.success(result);
	}

	@Post('preview-cache/missing')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '生成所有未缓存的课程文件图片预览缓存' })
	async warmupMissingPreviewCaches() {
		const result = await this.adminCourseService.warmupAllMissingPreviewCaches();
		return CommonResponseDto.success(result);
	}

	@Post(':id/preview-cache')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '生成课程文件图片预览缓存' })
	async warmupPreviewCache(
		@Param('id') id: number,
		@Body() body: { force?: boolean } = {},
	) {
		const result = await this.adminCourseService.warmupPreviewCache(+id, body?.force === true);
		return CommonResponseDto.success(result);
	}
}

@ApiTags('小程序端-课程管理')
@Controller('app/course-admin')
@UseGuards(JwtAuthGuard)
@UseFilters(HttpExceptionFilter)
@ApiBearerAuth()
export class AppCourseAdminController {
	constructor(
		private readonly adminCourseService: AdminCourseService,
		@InjectRepository(AppUser)
		private readonly appUserRepository: Repository<AppUser>,
	) {}

	@Post('file-course')
	@ApiOperation({ summary: '小程序管理员创建文件类课程' })
	async createFileCourse(@Body() body: Record<string, any>, @CurrentUser() user: any) {
		await this.assertAppAdmin(user);
		const name = String(body?.name || '').trim();
		const fileUrl = String(body?.file_url || body?.fileUrl || '').trim();
		const fileName = String(body?.file_name || body?.fileName || name || '').trim();
		const fileType = String(body?.file_type || body?.fileType || '').trim().toLowerCase();
		if (!name) {
			throw new BadRequestException('课程名称不能为空');
		}
		if (!fileUrl) {
			throw new BadRequestException('课程文件地址不能为空');
		}
		if (!['pdf', 'doc', 'docx'].includes(fileType)) {
			throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
		}

		const dto: CreateCourseDto = {
			name,
			subject: this.optionalText(body?.subject),
			category: this.optionalText(body?.category),
			sub_category: this.optionalText(body?.sub_category || body?.subCategory),
			school: this.optionalText(body?.school),
			major: this.optionalText(body?.major),
			exam_year: this.optionalText(body?.exam_year || body?.examYear),
			answer_year: this.optionalText(body?.answer_year || body?.answerYear),
			price: this.optionalNumber(body?.price, 0.5),
			agent_price: this.optionalNumber(body?.agent_price ?? body?.agentPrice, 0.1),
			is_free: this.optionalNumber(body?.is_free ?? body?.isFree, 0),
			validity_days: this.optionalNumber(body?.validity_days ?? body?.validityDays, 365),
			introduction: this.optionalText(body?.introduction),
			content_type: 'file',
			file_url: fileUrl,
			file_name: fileName || name,
			file_type: fileType,
			file_size: this.optionalNumber(body?.file_size ?? body?.fileSize, 0),
			allow_source_file: this.optionalNumber(body?.allow_source_file ?? body?.allowSourceFile, 0),
		};
		const result = await this.adminCourseService.saveCourse(dto);
		return CommonResponseDto.success(result);
	}

	private async assertAppAdmin(user: any) {
		const userId = Number(user?.userId || user?.id);
		if (userId) {
			const dbUser = await this.appUserRepository.findOne({ where: { id: userId }, select: ['id', 'role'] });
			if ([AppUserRole.ADMIN, AppUserRole.BANK_ADMIN].includes(dbUser?.role)) {
				return;
			}
		} else if ([AppUserRole.ADMIN, AppUserRole.BANK_ADMIN].includes(user?.role) || user?.is_admin === true || user?.is_bank_admin === true) {
			return;
		}
		throw new ForbiddenException('仅小程序管理员可上传课程');
	}

	private optionalText(value: unknown): string | undefined {
		const text = String(value ?? '').trim();
		return text || undefined;
	}

	private optionalNumber(value: unknown, fallback: number): number {
		if (value === undefined || value === null || value === '') {
			return fallback;
		}
		const num = Number(value);
		return Number.isFinite(num) ? num : fallback;
	}
}
