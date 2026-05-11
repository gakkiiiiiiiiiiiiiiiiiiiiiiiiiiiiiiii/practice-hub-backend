import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsNumber, IsIn, Min, Max } from 'class-validator';

export class UpdateCategoryDto {
  @ApiProperty({ description: '版块名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '版块类型', required: false, enum: ['course', 'category'] })
  @IsOptional()
  @IsString()
  @IsIn(['course', 'category'])
  type?: 'course' | 'category';

  @ApiProperty({ description: '分类板块绑定的一级分类ID', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bind_category_id?: number | null;

  @ApiProperty({ description: '排序权重', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sort?: number;

  @ApiProperty({ description: '小程序端每行显示列数', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(4)
  columns?: number;

  @ApiProperty({ description: '状态', required: false, enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsIn([0, 1])
  status?: number;
}
