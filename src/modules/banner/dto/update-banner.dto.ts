import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsUrl, MaxLength } from 'class-validator';
import { CreateBannerDto } from './create-banner.dto';

export class UpdateBannerDto extends PartialType(CreateBannerDto) {
	@ApiProperty({ description: '轮播图图片URL', required: false })
	@IsOptional()
	@IsString()
	@IsUrl({}, { message: '图片URL格式不正确' })
	image?: string;

	@ApiProperty({ description: '跳转链接', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(500, { message: '跳转链接长度不能超过500个字符' })
	link?: string;

	@ApiProperty({ description: '标题', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(100, { message: '标题长度不能超过100个字符' })
	title?: string;

	@ApiProperty({ description: '排序号', required: false })
	@IsOptional()
	@IsNumber({}, { message: '排序号必须是数字' })
	sort_order?: number;

	@ApiProperty({ description: '状态（0-禁用，1-启用）', required: false })
	@IsOptional()
	@IsNumber({}, { message: '状态必须是数字' })
	status?: number;
}
