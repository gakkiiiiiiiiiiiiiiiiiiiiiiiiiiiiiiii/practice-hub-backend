import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetCourseListDto {
  @ApiPropertyOptional({ description: '搜索关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '一级分类' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '二级分类' })
  @IsOptional()
  @IsString()
  subCategory?: string;

  @ApiPropertyOptional({
    description: '排序方式',
    enum: ['default', 'sales', 'latest', 'price_asc', 'price_desc'],
    default: 'default',
  })
  @IsOptional()
  @IsIn(['default', 'sales', 'latest', 'price_asc', 'price_desc'])
  sortBy?: string;

  @ApiPropertyOptional({ description: '课程类型 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  courseTypeId?: number;

  @ApiPropertyOptional({ description: '所属书本名称' })
  @IsOptional()
  @IsString()
  bookName?: string;

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数', default: 50, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 50;
}
