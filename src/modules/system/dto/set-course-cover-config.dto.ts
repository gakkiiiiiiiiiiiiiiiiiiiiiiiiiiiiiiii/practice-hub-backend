import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CourseCoverFieldDto {
  @ApiProperty({ description: '字段唯一ID', example: 'school' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: '字段显示名称', example: '学校' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ description: '字段类型', enum: ['courseField', 'staticText'], example: 'courseField' })
  @IsString()
  @IsIn(['courseField', 'staticText'])
  type: 'courseField' | 'staticText';

  @ApiProperty({ description: '课程字段名或内置字段名', required: false, example: 'school' })
  @IsOptional()
  @IsString()
  sourceKey?: string;

  @ApiProperty({ description: '静态文本内容', required: false, example: '下一站上岸书店' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiProperty({ description: 'X坐标（px）', example: 600 })
  @Type(() => Number)
  @IsInt()
  x: number;

  @ApiProperty({ description: 'Y坐标（px）', example: 320 })
  @Type(() => Number)
  @IsInt()
  y: number;

  @ApiProperty({ description: '字体大小（px）', example: 108 })
  @Type(() => Number)
  @IsInt()
  @Min(8)
  @Max(240)
  fontSize: number;

  @ApiProperty({ description: '颜色', example: '#58A7F7' })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiProperty({ description: '文本背景色', required: false, example: 'transparent' })
  @IsOptional()
  @IsString()
  backgroundColor?: string;

  @ApiProperty({ description: '字体粗细', required: false, example: '700' })
  @IsOptional()
  @IsString()
  fontWeight?: string;

  @ApiProperty({ description: '字体族', required: false, example: 'serif' })
  @IsOptional()
  @IsString()
  fontFamily?: string;

  @ApiProperty({ description: '最大宽度（px）', required: false, example: 900 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxWidth?: number;

  @ApiProperty({ description: '文本对齐', required: false, enum: ['left', 'center', 'right'], example: 'center' })
  @IsOptional()
  @IsString()
  @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';

  @ApiProperty({ description: '最大行数', required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxLines?: number;

  @ApiProperty({ description: '行高（px）', required: false, example: 36 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(300)
  lineHeight?: number;
}

class CourseCoverSingleConfigDto {
  @ApiProperty({ description: '背景图 URL', required: false })
  @IsOptional()
  @IsString()
  backgroundImage?: string;

  @ApiProperty({ description: '背景色', required: false, example: '#5d9ef0' })
  @IsOptional()
  @IsString()
  backgroundColor?: string;

  @ApiProperty({ description: '画布宽度', example: 1200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(4000)
  width: number;

  @ApiProperty({ description: '画布高度', example: 1200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(4000)
  height: number;

  @ApiProperty({ description: '字段配置列表', type: [CourseCoverFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseCoverFieldDto)
  fields: CourseCoverFieldDto[];
}

class CourseCoverTemplateItemDto {
  @ApiProperty({ description: '模板ID', example: 'default' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: '模板名称', example: '默认课程封面' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '绑定分类路径', required: false, example: ['考研专业课', '心理学'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bindCategory?: string[];

  @ApiProperty({ description: '封面配置', type: CourseCoverSingleConfigDto })
  @ValidateNested()
  @Type(() => CourseCoverSingleConfigDto)
  config: CourseCoverSingleConfigDto;
}

export class SetCourseCoverConfigDto extends CourseCoverSingleConfigDto {
  @ApiProperty({ description: '当前默认模板ID', required: false })
  @IsOptional()
  @IsString()
  activeTemplateId?: string;

  @ApiProperty({ description: '多套封面模板', required: false, type: [CourseCoverTemplateItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseCoverTemplateItemDto)
  templates?: CourseCoverTemplateItemDto[];
}
