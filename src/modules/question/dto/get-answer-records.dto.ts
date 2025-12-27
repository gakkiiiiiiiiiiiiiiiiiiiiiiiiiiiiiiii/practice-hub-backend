import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetAnswerRecordsDto {
  @ApiProperty({ description: '章节ID（可选）', example: 1, required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  })
  @IsNumber()
  chapterId?: number;

  @ApiProperty({ description: '题目ID列表（可选）', example: [1, 2, 3], required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    // 如果是数组，直接转换
    if (Array.isArray(value)) {
      return value.map(id => Number(id)).filter(id => !isNaN(id));
    }
    // 如果是字符串（逗号分隔），转换为数组
    if (typeof value === 'string') {
      return value.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id));
    }
    return undefined;
  })
  @IsArray()
  questionIds?: number[];
}

