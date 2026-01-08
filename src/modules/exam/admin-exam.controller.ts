import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExamService } from './exam.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateExamConfigDto } from './dto/create-exam-config.dto';

@ApiTags('后台-考试管理')
@Controller('admin/exam')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminExamController {
	constructor(private readonly examService: ExamService) {}

	@Get('config/list')
	@ApiOperation({ summary: '获取考试配置列表' })
	async getExamConfigList(@Query('courseId') courseId?: number) {
		const result = await this.examService.getExamConfigList(courseId);
		return CommonResponseDto.success(result);
	}

	@Get('config/:id')
	@ApiOperation({ summary: '获取考试配置详情' })
	async getExamConfig(@Param('id') id: number) {
		const result = await this.examService.getExamConfig(id);
		return CommonResponseDto.success(result);
	}

	@Post('config')
	@ApiOperation({ summary: '创建考试配置' })
	async createExamConfig(@Body() dto: CreateExamConfigDto) {
		const result = await this.examService.saveExamConfig(dto);
		return CommonResponseDto.success(result);
	}

	@Put('config/:id')
	@ApiOperation({ summary: '更新考试配置' })
	async updateExamConfig(@Param('id') id: number, @Body() dto: CreateExamConfigDto) {
		const result = await this.examService.saveExamConfig(dto, id);
		return CommonResponseDto.success(result);
	}

	@Delete('config/:id')
	@ApiOperation({ summary: '删除考试配置' })
	async deleteExamConfig(@Param('id') id: number) {
		const result = await this.examService.deleteExamConfig(id);
		return CommonResponseDto.success(result);
	}
}
