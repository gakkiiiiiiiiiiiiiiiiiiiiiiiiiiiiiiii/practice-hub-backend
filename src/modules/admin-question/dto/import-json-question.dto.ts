import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsArray, ValidateNested, IsEnum, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '../../../database/entities/question.entity';

class QuestionItemDto {
	@ApiProperty({ description: '题型', example: 1, enum: QuestionType })
	@IsNotEmpty({ message: '题型不能为空' })
	@IsEnum(QuestionType)
	type: QuestionType;

	@ApiProperty({ description: '题干（富文本）', example: '这是一道题目' })
	@IsNotEmpty({ message: '题干不能为空' })
	@IsString()
	stem: string;

	@ApiProperty({
		description: '选项',
		example: [{ label: 'A', text: '选项A' }],
		required: false,
	})
	@IsOptional()
	@IsArray()
	options?: Array<{ label: string; text: string }>;

	@ApiProperty({ description: '正确答案', example: ['A'] })
	@IsNotEmpty({ message: '正确答案不能为空' })
	@IsArray()
	answer: string[];

	@ApiProperty({ description: '解析（富文本）', required: false })
	@IsOptional()
	@IsString()
	analysis?: string;
}

export class ImportJsonQuestionDto {
	@ApiProperty({ description: '章节ID', example: 1 })
	@IsNotEmpty({ message: '章节ID不能为空' })
	@IsNumber()
	chapterId: number;

	@ApiProperty({ description: '题目列表', type: [QuestionItemDto] })
	@IsNotEmpty({ message: '题目列表不能为空' })
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => QuestionItemDto)
	questions: QuestionItemDto[];
}
