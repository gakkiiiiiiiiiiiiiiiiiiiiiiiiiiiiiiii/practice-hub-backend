import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsIn, Min, Max } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: '版块名称', example: '热门公共课' })
  @IsNotEmpty({ message: '版块名称不能为空' })
  @IsString()
  name: string;

  @ApiProperty({ description: '版块类型', example: 'course', enum: ['course', 'category'], required: false })
  @IsOptional()
  @IsString()
  @IsIn(['course', 'category'])
  type?: 'course' | 'category';

  @ApiProperty({ description: '分类板块绑定的一级分类ID', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bind_category_id?: number | null;

  @ApiProperty({ description: '排序权重', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sort?: number;

  @ApiProperty({ description: '小程序端每行显示列数', example: 3, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(4)
  columns?: number;

  @ApiProperty({ description: '状态', example: 1, enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsIn([0, 1])
  status?: number;
}
