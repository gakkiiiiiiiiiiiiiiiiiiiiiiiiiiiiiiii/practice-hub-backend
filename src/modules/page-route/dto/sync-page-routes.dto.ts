import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, ValidateNested, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class PageRouteItemDto {
	@ApiProperty({ description: '页面路径', example: '/pages/index/index' })
	@IsNotEmpty({ message: '页面路径不能为空' })
	@IsString({ message: '页面路径必须是字符串' })
	path: string;

	@ApiProperty({ description: '页面标题', example: '首页' })
	@IsNotEmpty({ message: '页面标题不能为空' })
	@IsString({ message: '页面标题必须是字符串' })
	title: string;

	@ApiProperty({ description: '页面类型', example: 'main', required: false })
	@IsOptional()
	@IsString({ message: '页面类型必须是字符串' })
	type?: string;
}

export class SyncPageRoutesDto {
	@ApiProperty({ description: '页面路由列表', type: [PageRouteItemDto] })
	@IsNotEmpty({ message: '页面路由列表不能为空' })
	@IsArray({ message: '页面路由必须是数组' })
	@ValidateNested({ each: true })
	@Type(() => PageRouteItemDto)
	routes: PageRouteItemDto[];
}
