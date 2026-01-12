import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsEnum, MinLength, MaxLength, IsNumber } from 'class-validator';
import { AdminRole } from '../../../database/entities/sys-user.entity';

export class CreateAccountDto {
	@ApiProperty({ description: '用户名', example: 'admin' })
	@IsNotEmpty({ message: '用户名不能为空' })
	@IsString()
	@MinLength(3, { message: '用户名长度至少3个字符' })
	@MaxLength(50, { message: '用户名长度不能超过50个字符' })
	username: string;

	@ApiProperty({ description: '密码', example: '123456' })
	@IsNotEmpty({ message: '密码不能为空' })
	@IsString()
	@MinLength(6, { message: '密码长度至少6个字符' })
	password: string;

	@ApiProperty({ description: '角色', example: AdminRole.SUPER_ADMIN, enum: AdminRole })
	@IsNotEmpty({ message: '角色不能为空' })
	@IsEnum(AdminRole, { message: '角色格式不正确' })
	role: AdminRole;

	@ApiProperty({ description: '账号状态（0-禁用，1-启用）', example: 1, required: false })
	@IsOptional()
	status?: number;
}
