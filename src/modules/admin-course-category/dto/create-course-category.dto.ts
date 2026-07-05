import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, IsOptional, IsNumber, Min } from 'class-validator';
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

	@ApiProperty({ description: '分类封面图，主要用于二级分类首页展示', required: false })
	@IsOptional()
	@IsString()
	cover_img?: string | null;

	@ApiProperty({ description: '整类课程购买价格（整数元）', example: 30, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	bundle_price?: number;

	@ApiProperty({ description: '是否显示整类购买入口（0-隐藏，1-显示）', example: 1, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@IsIn([0, 1])
	bundle_enabled?: number;

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
