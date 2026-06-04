import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Body,
	Param,
	Query,
	Res,
	UseGuards,
	UseInterceptors,
	UseFilters,
	BadRequestException,
	ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminCourseService } from './admin-course.service';
import { SystemRoleService } from '../system-role/system-role.service';
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
import { BatchAdjustCoursePriceDto } from './dto/batch-adjust-price.dto';
import { CreateCourseFileDto, UpdateCourseFileDto } from './dto/course-file.dto';
import { SetCourseDefaultParamsDto } from '../system/dto/set-course-default-params.dto';
import { SetCourseSimilarityConfigDto } from './dto/set-course-similarity-config.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';

@ApiTags('管理后台-课程管理')
@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@UseFilters(HttpExceptionFilter)
@ApiBearerAuth()
export class AdminCourseController {
	constructor(
		private readonly adminCourseService: AdminCourseService,
		private readonly systemRoleService: SystemRoleService,
	) {}

	@Post()
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '新增课程' })
	async createCourse(@Body() dto: CreateCourseDto) {
		const result = await this.adminCourseService.saveCourse(dto);
		return CommonResponseDto.success(result);
	}

	@Get('default-params')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取新增课程默认参数' })
	async getCourseDefaultParams() {
		const result = await this.adminCourseService.getCourseDefaultParams();
		return CommonResponseDto.success(result);
	}

	@Put('default-params')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '设置新增课程默认参数' })
	async setCourseDefaultParams(@Body() dto: SetCourseDefaultParamsDto) {
		const result = await this.adminCourseService.setCourseDefaultParams(dto as Record<string, any>);
		return CommonResponseDto.success(result);
	}

	@Get('similarity-config')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN, AdminRole.AGENT)
	@ApiOperation({ summary: '获取课程同名/类似检测配置' })
	async getCourseSimilarityConfig() {
		const result = await this.adminCourseService.getCourseSimilarityConfig();
		return CommonResponseDto.success(result);
	}

	@Put('similarity-config')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '设置课程同名/类似检测配置' })
	async setCourseSimilarityConfig(@Body() dto: SetCourseSimilarityConfigDto) {
		const result = await this.adminCourseService.setCourseSimilarityConfig(dto as Record<string, any>);
		return CommonResponseDto.success(result);
	}

	@Put(':id')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '编辑课程' })
	async updateCourse(@Param('id') id: number, @Body() dto: UpdateCourseDto, @CurrentUser() user: any) {
		const courseId = Number(id);
		if (!Number.isInteger(courseId) || courseId <= 0) {
			throw new BadRequestException('课程 ID 无效');
		}
		const result = await this.adminCourseService.saveCourse(dto, courseId, user?.role);
		return CommonResponseDto.success(result);
	}

	@Get('options')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN, AdminRole.AGENT)
	@ApiOperation({ summary: '获取课程下拉选项（轻量）' })
	async getCourseOptions(@Query('name') name?: string, @Query('status') status?: string) {
		const parsedStatus =
			status !== undefined && status !== '' ? Number(status) : undefined;
		const result = await this.adminCourseService.getCourseOptions({
			name,
			status: parsedStatus !== undefined && !Number.isNaN(parsedStatus) ? parsedStatus : undefined,
		});
		return CommonResponseDto.success(result);
	}

	@Get('similar-groups')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN, AdminRole.AGENT)
	@ApiOperation({ summary: '检测同名或类似课程分组' })
	async getSimilarCourseGroups(
		@Query('name') name?: string,
		@Query('subject') subject?: string,
		@Query('category') category?: string,
		@Query('subCategory') subCategory?: string,
		@Query('status') status?: string,
	) {
		const parsedStatus =
			status !== undefined && status !== '' ? Number(status) : undefined;
		const result = await this.adminCourseService.getSimilarCourseGroups({
			name,
			subject,
			category,
			subCategory,
			status: parsedStatus !== undefined && !Number.isNaN(parsedStatus) ? parsedStatus : undefined,
		});
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
		@Query('status') status?: string,
		@Query('similarOnly') similarOnly?: string,
	) {
		const parsedStatus =
			status !== undefined && status !== '' ? Number(status) : undefined;
		const result = await this.adminCourseService.getCourseList({
			name,
			subject,
			category,
			subCategory,
			status: parsedStatus !== undefined && !Number.isNaN(parsedStatus) ? parsedStatus : undefined,
			similarOnly: similarOnly === '1' || similarOnly === 'true',
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

	@Post('preview-cache/fix-blank')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '检测空白预览图课程并强制重新生成' })
	async fixBlankPreviewCaches() {
		const result = await this.adminCourseService.fixBlankPreviewCaches();
		return CommonResponseDto.success(result);
	}

	@Get('preview-cache/health')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '预览缓存健康巡检报告（空白/缺失/不完整）' })
	async getPreviewCacheHealth() {
		const result = await this.adminCourseService.getPreviewCacheHealthReport();
		return CommonResponseDto.success(result);
	}

	@Post('preview-cache/scheduled-maintenance')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '立即执行预览缓存定时巡检与自动修复' })
	async runPreviewCacheScheduledMaintenance() {
		const result = await this.adminCourseService.runScheduledPreviewCacheMaintenance();
		return CommonResponseDto.success(result);
	}

	@Get('preview-cache/targets')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取支持图片缓存的文件类课程列表' })
	async listPreviewCacheTargets(@Query('keyword') keyword?: string) {
		const result = await this.adminCourseService.listPreviewCacheTargets(keyword);
		return CommonResponseDto.success(result);
	}

	@Post('preview-cache/force-selected')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '强制重新生成指定课程的图片预览缓存' })
	async warmupSelectedPreviewCaches(@Body() body: { courseIds?: number[] } = {}) {
		const courseIds = Array.isArray(body?.courseIds) ? body.courseIds : [];
		const result = await this.adminCourseService.warmupSelectedPreviewCaches(courseIds);
		return CommonResponseDto.success(result);
	}

	@Post('files/pdf-health-check')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '检测指定 PDF 文件结构是否规范' })
	async checkCourseFilePdfHealthByUrl(@Body() body: { fileUrl?: string; displayName?: string } = {}) {
		const result = await this.adminCourseService.checkCourseFilePdfHealthByUrl(body?.fileUrl || '', body?.displayName);
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
	async batchUpdateStatus(@Body() dto: BatchUpdateStatusDto, @CurrentUser() user: any) {
		await this.systemRoleService.assertPermissionUsage(user?.role, 'course:status', user?.adminId);
		const result = await this.adminCourseService.batchUpdateStatus(dto);
		return CommonResponseDto.success(result);
	}

	@Post('batch-adjust-price')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '批量调整课程价格' })
	async batchAdjustPrice(@Body() dto: BatchAdjustCoursePriceDto) {
		const result = await this.adminCourseService.batchAdjustPrice(dto);
		return CommonResponseDto.success(result);
	}

	@Post('preview-cache/missing')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '生成所有未缓存的课程文件图片预览缓存' })
	async warmupMissingPreviewCaches() {
		const result = await this.adminCourseService.warmupAllMissingPreviewCaches();
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

	@Get(':id/files/pdf-health')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '检测课程 PDF 文件结构是否规范' })
	async getCourseFilesPdfHealth(@Param('id') id: number) {
		const result = await this.adminCourseService.getCourseFilesPdfHealth(+id);
		return CommonResponseDto.success(result);
	}

	@Get(':id/files')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取课程文件列表' })
	async listCourseFiles(@Param('id') id: number) {
		const result = await this.adminCourseService.listCourseFiles(+id);
		return CommonResponseDto.success(result);
	}

	@Post(':id/files')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '新增课程文件' })
	async createCourseFile(@Param('id') id: number, @Body() dto: CreateCourseFileDto) {
		const result = await this.adminCourseService.createCourseFile(+id, dto);
		return CommonResponseDto.success(result);
	}

	@Put(':id/files/:fileId')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '更新课程文件（展示名/排序/替换文件）' })
	async updateCourseFile(
		@Param('id') id: number,
		@Param('fileId') fileId: number,
		@Body() dto: UpdateCourseFileDto,
	) {
		const result = await this.adminCourseService.updateCourseFile(+id, +fileId, dto);
		return CommonResponseDto.success(result);
	}

	@Delete(':id/files/:fileId')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '删除课程文件' })
	async deleteCourseFile(
		@Param('id') id: number,
		@Param('fileId') fileId: number,
		@CurrentUser() user: any,
	) {
		await this.adminCourseService.deleteCourseFile(+id, +fileId, user?.role);
		return CommonResponseDto.success(null);
	}

	@Get(':id/preview-sample-pages')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取课程文件前三页预览图状态（管理后台）' })
	async getPreviewSamplePages(
		@Param('id') id: number,
		@Query('fileId') fileIdStr?: string,
	) {
		const fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
		const result = await this.adminCourseService.getPreviewSamplePages(
			+id,
			Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
		);
		return CommonResponseDto.success(result);
	}

	@Get(':id/preview-sample-page/:pageNum')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取课程文件指定预览页图片（管理后台，仅前 3 页）' })
	async getPreviewSamplePageImage(
		@Param('id') id: number,
		@Param('pageNum') pageNumStr: string,
		@Res({ passthrough: false }) res: Response,
		@Query('fileId') fileIdStr?: string,
	) {
		const pageNum = parseInt(pageNumStr, 10);
		if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 3) {
			return res.status(400).send('仅支持预览第 1-3 页');
		}
		const fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
		const { buffer, contentType } = await this.adminCourseService.getPreviewSamplePageImage(
			+id,
			pageNum,
			Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
		);
		const etag = `"${createHash('sha1').update(buffer).digest('base64url')}"`;
		res.setHeader('Content-Type', contentType);
		res.setHeader('Content-Length', String(buffer.length));
		res.setHeader('Cache-Control', 'private, max-age=86400');
		res.setHeader('ETag', etag);
		res.send(buffer);
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

	@Post(':id/preview-cache/warmup-after-save')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '课程文件保存完成后统一生成缺失图片预览缓存' })
	async warmupPreviewCacheAfterFilesSync(
		@Param('id') id: number,
		@Body() body: { force?: boolean } = {},
	) {
		const result = await this.adminCourseService.warmupPreviewCacheAfterFilesSync(+id, body?.force === true);
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
		if (!name) {
			throw new BadRequestException('课程名称不能为空');
		}

		const rawFiles = Array.isArray(body?.files) ? body.files : null;
		const fileInputs: Array<{
			display_name: string;
			file_url: string;
			file_name?: string;
			file_type: string;
			file_size?: number;
			sort?: number;
		}> = [];

		if (rawFiles && rawFiles.length > 0) {
			rawFiles.forEach((item: Record<string, unknown>, index: number) => {
				const fileUrl = String(item?.file_url || item?.fileUrl || '').trim();
				const fileType = String(item?.file_type || item?.fileType || '').trim().toLowerCase();
				const displayName = String(item?.display_name || item?.displayName || item?.file_name || item?.fileName || name).trim();
				if (!fileUrl) {
					throw new BadRequestException(`第 ${index + 1} 个文件地址不能为空`);
				}
				if (!['pdf', 'doc', 'docx'].includes(fileType)) {
					throw new BadRequestException(`第 ${index + 1} 个文件仅支持 PDF、Word（.doc/.docx）`);
				}
				fileInputs.push({
					display_name: displayName,
					file_url: fileUrl,
					file_name: String(item?.file_name || item?.fileName || displayName).trim() || displayName,
					file_type: fileType,
					file_size: this.optionalNumber(item?.file_size ?? item?.fileSize, 0),
					sort: Number.isInteger(Number(item?.sort)) ? Number(item.sort) : index,
				});
			});
		} else {
			const fileUrl = String(body?.file_url || body?.fileUrl || '').trim();
			const fileName = String(body?.file_name || body?.fileName || name || '').trim();
			const fileType = String(body?.file_type || body?.fileType || '').trim().toLowerCase();
			if (!fileUrl) {
				throw new BadRequestException('课程文件地址不能为空');
			}
			if (!['pdf', 'doc', 'docx'].includes(fileType)) {
				throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
			}
			fileInputs.push({
				display_name: fileName || name,
				file_url: fileUrl,
				file_name: fileName || name,
				file_type: fileType,
				file_size: this.optionalNumber(body?.file_size ?? body?.fileSize, 0),
				sort: 0,
			});
		}

		const primary = fileInputs[0];
		const dto: CreateCourseDto = {
			name,
			subject: this.optionalText(body?.subject),
			category: this.optionalText(body?.category),
			sub_category: this.optionalText(body?.sub_category || body?.subCategory),
			school: this.optionalText(body?.school),
			major: this.optionalText(body?.major),
			exam_year: this.optionalText(body?.exam_year || body?.examYear),
			answer_year: this.optionalText(body?.answer_year || body?.answerYear),
			price: this.optionalNumber(body?.price, 1),
			agent_price: this.optionalNumber(body?.agent_price ?? body?.agentPrice, 1),
			is_free: this.optionalNumber(body?.is_free ?? body?.isFree, 0),
			validity_days: this.optionalNumber(body?.validity_days ?? body?.validityDays, 365),
			introduction: this.optionalText(body?.introduction),
			content_type: 'file',
			file_url: primary.file_url,
			file_name: primary.file_name,
			file_type: primary.file_type,
			file_size: primary.file_size,
			allow_source_file: this.optionalNumber(body?.allow_source_file ?? body?.allowSourceFile, 0),
		};
		const saved = await this.adminCourseService.saveCourse(dto);
		for (let i = 0; i < fileInputs.length; i += 1) {
			const input = fileInputs[i];
			if (i === 0) {
				const existing = await this.adminCourseService.listCourseFiles(saved.id);
				if (existing.length > 0) {
					await this.adminCourseService.updateCourseFile(saved.id, existing[0].id, {
						display_name: input.display_name,
						sort: input.sort ?? 0,
					});
					continue;
				}
			}
			await this.adminCourseService.createCourseFile(saved.id, input);
		}
		void this.adminCourseService.warmupPreviewCacheAfterFilesSync(saved.id, false);
		return CommonResponseDto.success(saved);
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
