import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, IsArray, IsEnum } from 'class-validator';
import { QuestionType, Difficulty } from '../../../database/entities/question.entity';

export class UpdateQuestionDto {
  @ApiProperty({ description: '章节ID', required: false })
  @IsOptional()
  @IsNumber()
  chapter_id?: number;

  @ApiProperty({ description: '父题目ID', required: false })
  @IsOptional()
  @IsNumber()
  parent_id?: number;

  @ApiProperty({ description: '题型', required: false, enum: QuestionType })
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @ApiProperty({ description: '题干', required: false })
  @IsOptional()
  @IsString()
  stem?: string;

  @ApiProperty({ description: '选项', required: false })
  @IsOptional()
  @IsArray()
  options?: Array<{ label: string; text: string }>;

  @ApiProperty({ description: '正确答案', required: false })
  @IsOptional()
  @IsArray()
  answer?: string[];

  @ApiProperty({ description: '解析', required: false })
  @IsOptional()
  @IsString()
  analysis?: string;

  @ApiProperty({ description: '难度', required: false, enum: Difficulty })
  @IsOptional()
  @IsEnum(Difficulty)
  difficulty?: Difficulty;
}

