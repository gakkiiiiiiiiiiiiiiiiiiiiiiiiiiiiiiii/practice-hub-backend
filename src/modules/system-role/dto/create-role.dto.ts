import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsArray, MinLength, MaxLength, IsOptional, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRoleDto {
	@ApiProperty({ description: '角色标识', example: 'custom_role' })
	@IsNotEmpty({ message: '角色标识不能为空' })
	@IsString()
	@MinLength(2, { message: '角色标识长度至少2个字符' })
	@MaxLength(50, { message: '角色标识长度不能超过50个字符' })
	value: string;

	@ApiProperty({ description: '角色名称', example: '自定义角色' })
	@IsNotEmpty({ message: '角色名称不能为空' })
	@IsString()
	@MaxLength(50, { message: '角色名称长度不能超过50个字符' })
	name: string;

	@ApiProperty({ description: '角色描述', required: false })
	@IsOptional()
	@IsString()
	description?: string;

	@ApiProperty({ description: '权限列表', example: ['dashboard:view', 'question:view'] })
	@IsNotEmpty({ message: '权限列表不能为空' })
	@IsArray({ message: '权限必须是数组' })
	@IsString({ each: true, message: '权限项必须是字符串' })
	permissions: string[];

	@ApiProperty({ description: '权限每日调用上限，null/不传表示无限制', required: false, example: { 'course:status': 20 } })
	@IsOptional()
	@IsObject({ message: '权限调用限制必须是对象' })
	@Type(() => Object)
	permissionLimits?: Record<string, number | null>;
}
