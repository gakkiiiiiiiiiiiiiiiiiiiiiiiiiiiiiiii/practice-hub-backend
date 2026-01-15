import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsNumber, IsUrl, MaxLength } from 'class-validator';

export class CreateBannerDto {
	@ApiProperty({ description: '轮播图图片URL', example: 'https://example.com/banner.jpg' })
	@IsNotEmpty({ message: '图片URL不能为空' })
	@IsString()
	@IsUrl({}, { message: '图片URL格式不正确' })
	image: string;

	@ApiProperty({ description: '跳转链接', example: '/pages/course/1', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(500, { message: '跳转链接长度不能超过500个字符' })
	link?: string;

	@ApiProperty({ description: '标题', example: '活动标题', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(100, { message: '标题长度不能超过100个字符' })
	title?: string;

	@ApiProperty({ description: '排序号', example: 0, required: false })
	@IsOptional()
	@IsNumber({}, { message: '排序号必须是数字' })
	sort_order?: number;

	@ApiProperty({ description: '状态（0-禁用，1-启用）', example: 1, required: false })
	@IsOptional()
	@IsNumber({}, { message: '状态必须是数字' })
	status?: number;
}
