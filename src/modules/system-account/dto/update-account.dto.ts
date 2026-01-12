import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, MinLength, MaxLength, IsNumber } from 'class-validator';
import { AdminRole } from '../../../database/entities/sys-user.entity';

export class UpdateAccountDto {
	@ApiProperty({ description: '密码', required: false })
	@IsOptional()
	@IsString()
	@MinLength(6, { message: '密码长度至少6个字符' })
	password?: string;

	@ApiProperty({ description: '角色', example: AdminRole.SUPER_ADMIN, enum: AdminRole, required: false })
	@IsOptional()
	@IsEnum(AdminRole, { message: '角色格式不正确' })
	role?: AdminRole;

	@ApiProperty({ description: '账号状态（0-禁用，1-启用）', example: 1, required: false })
	@IsOptional()
	@IsNumber({}, { message: '状态必须是数字' })
	status?: number;
}
