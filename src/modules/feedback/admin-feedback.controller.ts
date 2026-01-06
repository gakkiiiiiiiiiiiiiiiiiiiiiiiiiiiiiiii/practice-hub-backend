import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { GetFeedbackListDto } from './dto/get-feedback-list.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('管理后台-反馈管理')
@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminFeedbackController {
	constructor(private readonly feedbackService: FeedbackService) {}

	@Post()
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '提交反馈（管理员）' })
	async createFeedback(@CurrentUser() user: any, @Body() dto: CreateFeedbackDto) {
		const result = await this.feedbackService.createAdminFeedback(user.userId, dto);
		return CommonResponseDto.success(result);
	}

	@Get()
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取反馈列表' })
	async getFeedbackList(@Query() dto: GetFeedbackListDto) {
		const result = await this.feedbackService.getFeedbackList(dto);
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '获取反馈详情' })
	async getFeedbackDetail(@Param('id') id: number) {
		const result = await this.feedbackService.getFeedbackDetail(id);
		return CommonResponseDto.success(result);
	}

	@Put(':id')
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiOperation({ summary: '更新反馈状态或回复' })
	async updateFeedback(
		@Param('id') id: number,
		@Body() dto: UpdateFeedbackDto,
		@CurrentUser() user: any
	) {
		const result = await this.feedbackService.updateFeedback(id, dto, user.userId);
		return CommonResponseDto.success(result);
	}

	@Delete(':id')
	@Roles(AdminRole.SUPER_ADMIN)
	@ApiOperation({ summary: '删除反馈' })
	async deleteFeedback(@Param('id') id: number) {
		await this.feedbackService.deleteFeedback(id);
		return CommonResponseDto.success(null, '删除成功');
	}
}

