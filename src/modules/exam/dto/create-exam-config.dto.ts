import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';

export class CreateExamConfigDto {
	@ApiProperty({ description: '课程ID', example: 1 })
	@IsNotEmpty({ message: '课程ID不能为空' })
	@IsNumber()
	course_id: number;

	@ApiProperty({ description: '考试名称', example: '26消1000题' })
	@IsNotEmpty({ message: '考试名称不能为空' })
	@IsString()
	name: string;

	@ApiProperty({ description: '考试时长（分钟）', example: 60 })
	@IsNotEmpty({ message: '考试时长不能为空' })
	@IsNumber()
	@Min(1)
	@Max(600)
	duration: number;

	@ApiProperty({ description: '单选题每题分数', example: 1 })
	@IsNotEmpty({ message: '单选题每题分数不能为空' })
	@IsNumber()
	@Min(0)
	single_choice_score: number;

	@ApiProperty({ description: '单选题数量', example: 16 })
	@IsNotEmpty({ message: '单选题数量不能为空' })
	@IsNumber()
	@Min(0)
	single_choice_count: number;

	@ApiProperty({ description: '多选题每题分数', example: 2 })
	@IsNotEmpty({ message: '多选题每题分数不能为空' })
	@IsNumber()
	@Min(0)
	multiple_choice_score: number;

	@ApiProperty({ description: '多选题数量', example: 17 })
	@IsNotEmpty({ message: '多选题数量不能为空' })
	@IsNumber()
	@Min(0)
	multiple_choice_count: number;

	@ApiProperty({ description: '判断题每题分数', example: 1 })
	@IsNotEmpty({ message: '判断题每题分数不能为空' })
	@IsNumber()
	@Min(0)
	judge_score: number;

	@ApiProperty({ description: '判断题数量', example: 0 })
	@IsNotEmpty({ message: '判断题数量不能为空' })
	@IsNumber()
	@Min(0)
	judge_count: number;

	@ApiProperty({ description: '及格分', example: 25 })
	@IsNotEmpty({ message: '及格分不能为空' })
	@IsNumber()
	@Min(0)
	pass_score: number;

	@ApiProperty({ description: '考试规则说明', required: false })
	@IsOptional()
	@IsString()
	rules?: string;

	@ApiProperty({ description: '是否启用', example: 1, required: false })
	@IsOptional()
	@IsNumber()
	is_enabled?: number;
}
