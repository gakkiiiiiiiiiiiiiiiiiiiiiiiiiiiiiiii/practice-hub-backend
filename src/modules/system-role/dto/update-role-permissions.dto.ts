import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, IsString } from 'class-validator';

export class UpdateRolePermissionsDto {
	@ApiProperty({ description: '权限列表', example: ['dashboard:view', 'question:view'] })
	@IsNotEmpty({ message: '权限列表不能为空' })
	@IsArray({ message: '权限必须是数组' })
	@IsString({ each: true, message: '权限项必须是字符串' })
	permissions: string[];
}
