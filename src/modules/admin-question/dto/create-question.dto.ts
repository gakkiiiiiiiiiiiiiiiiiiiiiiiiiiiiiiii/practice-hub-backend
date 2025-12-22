import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, IsArray, IsEnum } from 'class-validator';
import { QuestionType, Difficulty } from '../../../database/entities/question.entity';

export class CreateQuestionDto {
  @ApiProperty({ description: '章节ID', example: 1 })
  @IsNotEmpty({ message: '章节ID不能为空' })
  @IsNumber()
  chapter_id: number;

  @ApiProperty({ description: '父题目ID（阅读理解用）', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  parent_id?: number;

  @ApiProperty({ description: '题型', example: 1, enum: QuestionType })
  @IsNotEmpty({ message: '题型不能为空' })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty({ description: '题干（富文本）', example: '这是一道题目' })
  @IsNotEmpty({ message: '题干不能为空' })
  @IsString()
  stem: string;

  @ApiProperty({ description: '选项', example: [{ label: 'A', text: '选项A' }], required: false })
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

  @ApiProperty({ description: '难度', example: 2, enum: Difficulty, required: false })
  @IsOptional()
  @IsEnum(Difficulty)
  difficulty?: Difficulty;
}

