import { Controller, Get, Post, Body, Param, Query, UseGuards, Delete, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExamService } from './exam.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { StartExamDto } from './dto/start-exam.dto';
import { SubmitExamDto } from './dto/submit-exam.dto';

@ApiTags('模拟考试')
@Controller('app/exam')
export class ExamController {
	constructor(private readonly examService: ExamService) {}

	@Get('config/:courseId')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取课程的考试配置列表' })
	async getExamConfigs(@Param('courseId') courseId: number) {
		const result = await this.examService.getExamConfigList(courseId);
		return CommonResponseDto.success(result);
	}

	@Get('config/detail/:id')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取考试配置详情' })
	async getExamConfigDetail(@Param('id') id: number) {
		const result = await this.examService.getExamConfig(id);
		return CommonResponseDto.success(result);
	}

	@Post('start')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '开始考试' })
	async startExam(@CurrentUser() user: any, @Body() dto: StartExamDto) {
		const result = await this.examService.startExam(user.userId, dto);
		return CommonResponseDto.success(result);
	}

	@Post('submit')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '提交考试' })
	async submitExam(@CurrentUser() user: any, @Body() dto: SubmitExamDto) {
		const result = await this.examService.submitExam(user.userId, dto);
		return CommonResponseDto.success(result);
	}

	@Get('records')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取考试记录列表' })
	async getExamRecords(@CurrentUser() user: any, @Query('examConfigId') examConfigId?: number) {
		const result = await this.examService.getExamRecords(user.userId, examConfigId);
		return CommonResponseDto.success(result);
	}

	@Get('records/:id')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '获取考试记录详情' })
	async getExamRecordDetail(@CurrentUser() user: any, @Param('id') id: number) {
		const result = await this.examService.getExamRecordDetail(user.userId, id);
		return CommonResponseDto.success(result);
	}
}
