import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsObject, IsString, IsArray } from 'class-validator';

export class SubmitExamDto {
	@ApiProperty({ description: '考试配置ID', example: 1 })
	@IsNotEmpty({ message: '考试配置ID不能为空' })
	@IsNumber()
	exam_config_id: number;

	@ApiProperty({ description: '用户答案 { questionId: answer }', example: { 1: 'A', 2: ['A', 'B'] } })
	@IsNotEmpty({ message: '用户答案不能为空' })
	@IsObject()
	user_answers: Record<number, string | string[]>;

	@ApiProperty({ description: '开始时间', example: '2026-01-08T10:00:00Z' })
	@IsNotEmpty({ message: '开始时间不能为空' })
	@IsString()
	start_time: string;
}
