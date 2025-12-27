import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray, ValidateIf } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetAnswerRecordsDto {
  @ApiProperty({ description: '章节ID（可选）', example: 1, required: false })
  @IsOptional()
  @Transform(({ value }) => {
    console.log('[DTO Transform] chapterId 转换 - 原始值:', value, '类型:', typeof value);
    if (value === undefined || value === null || value === '') {
      console.log('[DTO Transform] chapterId 为空，返回 undefined');
      return undefined;
    }
    // 尝试转换为数字
    let num: number;
    if (typeof value === 'number') {
      num = value;
    } else if (typeof value === 'string') {
      num = parseInt(value, 10);
    } else {
      num = Number(value);
    }
    
    console.log('[DTO Transform] chapterId 转换结果:', num, '是否NaN:', isNaN(num));
    
    if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
      console.log('[DTO Transform] chapterId 无效，返回 undefined');
      return undefined;
    }
    
    return num;
  })
  @ValidateIf((o) => o.chapterId !== undefined && o.chapterId !== null)
  @IsNumber({}, { message: '章节ID必须是数字' })
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
  @ValidateIf((o) => o.questionIds !== undefined && o.questionIds !== null)
  @IsArray({ message: '题目ID列表必须是数组' })
  questionIds?: number[];
}

