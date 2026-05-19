import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, IsString, IsObject, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateRolePermissionsDto {
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
