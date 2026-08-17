import { Controller, Post, Get, Body, UseGuards, Query, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { GetFeedbackListDto } from './dto/get-feedback-list.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('反馈')
@Controller('app/feedback')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FeedbackController {
	constructor(private readonly feedbackService: FeedbackService) {}

	@Post()
	@ApiOperation({ summary: '提交反馈' })
	async createFeedback(@CurrentUser() user: any, @Body() dto: CreateFeedbackDto) {
		const result = await this.feedbackService.createFeedback(user.userId, dto);
		return CommonResponseDto.success(result);
	}

	@Get()
	@ApiOperation({ summary: '获取我的反馈列表' })
	async getMyFeedbackList(@CurrentUser() user: any, @Query() query: GetFeedbackListDto) {
		const result = await this.feedbackService.getUserFeedbackList(user.userId, query.page, query.pageSize);
		return CommonResponseDto.success(result);
	}

	@Get('unread-replies')
	@ApiOperation({ summary: '获取未读反馈回复摘要' })
	async getUnreadReplySummary(@CurrentUser() user: any) {
		const result = await this.feedbackService.getUnreadReplySummary(user.userId);
		return CommonResponseDto.success(result);
	}

	@Post(':id/read-reply')
	@ApiOperation({ summary: '标记反馈回复为已读' })
	async markReplyAsRead(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
		const result = await this.feedbackService.markReplyAsRead(user.userId, id);
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@ApiOperation({ summary: '获取反馈详情' })
	async getFeedbackDetail(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
		const result = await this.feedbackService.getUserFeedbackDetail(user.userId, id);
		return CommonResponseDto.success(result);
	}
}
