import { Controller, Get, Post, Param, Body, UseGuards, Logger, Query, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { QuestionService } from './question.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { BatchSubmitDto } from './dto/batch-submit.dto';
import { GetAnswerRecordsDto } from './dto/get-answer-records.dto';

@ApiTags('题目')
@Controller('app/questions')
export class QuestionController {
	private readonly logger = new Logger(QuestionController.name);

	constructor(private readonly questionService: QuestionService) {}

	@Get('courses/:id/questions')
	@UseGuards(OptionalJwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取课程下的题目列表（用于随机练习和模拟考试）' })
	async getCourseQuestions(
		@Param('id') id: number,
		@Query('count') count?: number,
		@Query('random') random?: string,
		@CurrentUser() user?: any
	) {
		try {
			const courseId = +id;
			const userId = user?.userId;
			const questionCount = count ? +count : undefined;
			const isRandom = random === 'true' || random === '1';

			this.logger.log(
				`获取课程题目列表 - 课程ID: ${courseId}, 用户ID: ${userId || '未登录'}, 数量: ${questionCount || '全部'}, 随机: ${isRandom}`
			);

			const result = await this.questionService.getCourseQuestions(courseId, userId, questionCount, isRandom);

			this.logger.log(`成功获取课程题目列表 - 课程ID: ${courseId}, 题目数量: ${result.length}`);

			return CommonResponseDto.success(result);
		} catch (error) {
			this.logger.error(`获取课程题目列表失败 - 课程ID: ${id}`, {
				error: error.message,
				stack: error.stack,
				userId: user?.userId,
			});
			throw error;
		}
	}

	@Get('chapters/:id/questions')
	@UseGuards(OptionalJwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取章节下的题目列表' })
	async getChapterQuestions(@Param('id') id: number, @CurrentUser() user?: any) {
		try {
			const chapterId = +id;
			const userId = user?.userId;

			this.logger.log(`获取章节题目列表 - 章节ID: ${chapterId}, 用户ID: ${userId || '未登录'}`);

			const result = await this.questionService.getChapterQuestions(chapterId, userId);

			this.logger.log(`成功获取章节题目列表 - 章节ID: ${chapterId}, 题目数量: ${result.length}`);

			return CommonResponseDto.success(result);
		} catch (error) {
			this.logger.error(`获取章节题目列表失败 - 章节ID: ${id}`, {
				error: error.message,
				stack: error.stack,
				userId: user?.userId,
			});
			throw error;
		}
	}

	// ⚠️ 重要：静态路由必须放在动态路由之前！
	// 否则 '/answer-records' 会被 ':id' 路由匹配
	@Get('answer-records')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取用户答题记录' })
	async getAnswerRecords(@CurrentUser() user: any, @Query() dto: GetAnswerRecordsDto, @Req() request: Request) {
		try {
			this.logger.log('=== getAnswerRecords 方法被调用 ===');
			this.logger.log('request.query:', JSON.stringify(request.query));
			this.logger.log('dto:', JSON.stringify(dto));
			this.logger.log(
				'dto.chapterId:',
				dto?.chapterId,
				'类型:',
				typeof dto?.chapterId,
				'isNaN:',
				dto?.chapterId !== undefined ? isNaN(Number(dto.chapterId)) : 'N/A'
			);
			this.logger.log('user:', user ? JSON.stringify({ userId: user.userId, type: user.type }) : 'null');

			const userId = user?.userId;
			if (!userId) {
				this.logger.error('用户未登录');
				throw new BadRequestException('用户未登录');
			}

			// 手动转换 chapterId（如果 DTO 转换失败）
			let chapterId: number | undefined = undefined;
			if (dto?.chapterId !== undefined && dto?.chapterId !== null) {
				if (typeof dto.chapterId === 'number') {
					if (Number.isSafeInteger(dto.chapterId) && dto.chapterId > 0) {
						chapterId = dto.chapterId;
					} else {
						this.logger.warn(`DTO chapterId 无效（数字）: ${dto.chapterId}`);
					}
				} else if (typeof dto.chapterId === 'string') {
					const numId = parseInt(dto.chapterId, 10);
					if (Number.isSafeInteger(numId) && numId > 0) {
						chapterId = numId;
						this.logger.log(`手动转换 chapterId: "${dto.chapterId}" -> ${chapterId}`);
					} else {
						this.logger.warn(`DTO chapterId 无效（字符串）: "${dto.chapterId}" -> ${numId}`);
					}
				} else {
					this.logger.warn(`DTO chapterId 类型不支持: ${typeof dto.chapterId}`);
				}
			}

			// 如果手动转换成功，使用转换后的值；否则使用 DTO 的值
			const finalChapterId = chapterId !== undefined ? chapterId : dto?.chapterId;
			const questionIds = dto?.questionIds;

			this.logger.log(
				`查询参数 - userId: ${userId}, chapterId: ${finalChapterId} (${typeof finalChapterId}), questionIds: ${JSON.stringify(questionIds)}`
			);

			const result = await this.questionService.getAnswerRecords(userId, finalChapterId, questionIds);

			this.logger.log(`✅ 查询完成 - 记录数量: ${result.length}`);
			return CommonResponseDto.success(result);
		} catch (error) {
			this.logger.error('❌ getAnswerRecords 异常:', {
				message: error.message,
				stack: error.stack,
				dto: JSON.stringify(dto),
				user: user ? { userId: user.userId } : null,
			});
			throw error;
		}
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取单题详情' })
	async getQuestionDetail(@Param('id') id: number, @CurrentUser() user?: any) {
		const userId = user?.userId;
		const result = await this.questionService.getQuestionDetail(+id, userId);
		return CommonResponseDto.success(result);
	}

	@Post('submit')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '提交答案' })
	async submitAnswer(@CurrentUser() user: any, @Body() dto: SubmitAnswerDto) {
		const result = await this.questionService.submitAnswer(user.userId, dto);
		return CommonResponseDto.success(result);
	}

	@Post('batch_submit')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '批量提交（试卷模式）' })
	async batchSubmit(@CurrentUser() user: any, @Body() dto: BatchSubmitDto) {
		const result = await this.questionService.batchSubmit(user.userId, dto);
		return CommonResponseDto.success(result);
	}
}
