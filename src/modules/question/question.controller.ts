import { Controller, Get, Post, Param, Body, UseGuards, Logger, Query, Req } from '@nestjs/common';
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

  @Get('answer-records')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取用户答题记录' })
  async getAnswerRecords(
    @CurrentUser() user: any,
    @Query() dto: GetAnswerRecordsDto,
    @Req() request: Request,
  ) {
    this.logger.log('=== 开始处理获取用户答题记录请求 ===');
    
    try {
      // 记录原始请求参数
      this.logger.log('原始请求参数:', {
        query: request.query,
        user: user ? { userId: user.userId, type: user.type } : null,
        dto: {
          chapterId: dto?.chapterId,
          questionIds: dto?.questionIds,
          dtoType: typeof dto,
          dtoKeys: dto ? Object.keys(dto) : [],
          rawDto: JSON.stringify(dto),
        },
      });

      const userId = user?.userId;
      
      if (!userId) {
        this.logger.error('❌ 获取用户答题记录失败 - 用户未登录', {
          user: user,
          dto: dto,
        });
        throw new Error('用户未登录');
      }

      this.logger.log(`✅ 用户认证成功 - 用户ID: ${userId}`);

      const chapterId = dto?.chapterId;
      const questionIds = dto?.questionIds;

      this.logger.log(`📋 查询参数 - 用户ID: ${userId}, 章节ID: ${chapterId || '全部'}, 题目数量: ${questionIds?.length || '全部'}`);

      const result = await this.questionService.getAnswerRecords(userId, chapterId, questionIds);

      this.logger.log(`✅ 成功获取用户答题记录 - 用户ID: ${userId}, 记录数量: ${result.length}`);
      this.logger.log('=== 请求处理完成 ===');

      return CommonResponseDto.success(result);
    } catch (error) {
      this.logger.error('❌ 获取用户答题记录失败', {
        error: {
          message: error.message,
          name: error.name,
          code: error.code,
          stack: error.stack,
        },
        user: user ? { userId: user.userId, type: user.type } : null,
        dto: {
          chapterId: dto?.chapterId,
          questionIds: dto?.questionIds,
          rawDto: dto,
        },
      });
      this.logger.error('=== 请求处理失败 ===');
      throw error;
    }
  }
}

