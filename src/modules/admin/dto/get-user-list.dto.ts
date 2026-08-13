import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, IsEnum, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { AppUserRole } from '../../../database/entities/app-user.entity';

export class GetUserListDto {
	@ApiProperty({ description: '页码', example: 1, required: false, default: 1 })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return 1;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) || !Number.isFinite(num) || num < 1 ? 1 : num;
	})
	@IsNumber({}, { message: '页码必须是数字' })
	@Min(1)
	page?: number;

	@ApiProperty({ description: '每页数量', example: 10, required: false, default: 10 })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return 10;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) || !Number.isFinite(num) || num < 1 ? 10 : num;
	})
	@IsNumber({}, { message: '每页数量必须是数字' })
	@Min(1)
	pageSize?: number;

	@ApiProperty({ description: '搜索关键词（昵称、OpenID、手机号）', required: false })
	@IsOptional()
	@IsString()
	keyword?: string;

	@ApiProperty({ description: '账号状态（0-已封禁，1-正常）', required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) || !Number.isFinite(num) ? undefined : num;
	})
	@IsNumber({}, { message: '状态必须是数字' })
	status?: number;

	@ApiProperty({
		description: '小程序角色',
		enum: AppUserRole,
		required: false,
	})
	@IsOptional()
	@IsEnum(AppUserRole, { message: '小程序角色无效' })
	role?: AppUserRole;
}
