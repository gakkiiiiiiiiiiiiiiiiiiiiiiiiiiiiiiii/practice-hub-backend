import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class GetAnswerRecordsDto {
  @ApiProperty({ description: '章节ID（可选）', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  chapterId?: number;

  @ApiProperty({ description: '题目ID列表（可选）', example: [1, 2, 3], required: false })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  questionIds?: number[];
}

