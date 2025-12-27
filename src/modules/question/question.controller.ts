import { Controller, Get, Post, Param, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuestionService } from './question.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { BatchSubmitDto } from './dto/batch-submit.dto';

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
}

