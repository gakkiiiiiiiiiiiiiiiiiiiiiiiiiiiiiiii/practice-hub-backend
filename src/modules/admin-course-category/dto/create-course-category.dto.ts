import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCourseCategoryDto {
	@ApiProperty({ description: '分类名称', example: '考研政治' })
	@IsNotEmpty({ message: '分类名称不能为空' })
	@IsString()
	name: string;

	@ApiProperty({ description: '父级分类ID，null表示一级分类', required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	parent_id?: number | null;

	@ApiProperty({ description: '排序', example: 0, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	sort?: number;

	@ApiProperty({ description: '状态（0-禁用，1-启用）', example: 1, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	status?: number;
}
