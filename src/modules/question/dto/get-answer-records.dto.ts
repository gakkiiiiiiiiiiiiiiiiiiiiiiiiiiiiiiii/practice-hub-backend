import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray, ValidateIf } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetAnswerRecordsDto {
  @ApiProperty({ description: '章节ID（可选）', example: 1, required: false })
  @IsOptional()
  @Transform(({ value }) => {
    // 如果值为空，返回 undefined（可选参数）
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    
    // 尝试转换为数字
    let num: number;
    if (typeof value === 'number') {
      // 已经是数字，检查是否是 NaN
      if (isNaN(value) || !Number.isFinite(value)) {
        // 如果是 NaN 或 Infinity，返回 undefined，让验证器处理
        return undefined;
      }
      num = value;
    } else if (typeof value === 'string') {
      // 字符串，使用 parseInt 转换
      const trimmed = value.trim();
      if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
        return undefined;
      }
      num = parseInt(trimmed, 10);
    } else {
      // 其他类型，尝试 Number 转换
      num = Number(value);
    }
    
    // 严格验证转换结果
    if (isNaN(num) || !Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
      // 转换失败或无效，返回 undefined（让后续验证处理）
      // 注意：不要返回 NaN，因为 enableImplicitConversion 可能会将其转换为字符串 'NaN'
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

