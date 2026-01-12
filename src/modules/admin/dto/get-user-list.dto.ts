import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetUserListDto {
	@ApiProperty({ description: '页码', example: 1, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	page?: number = 1;

	@ApiProperty({ description: '每页数量', example: 10, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	pageSize?: number = 10;

	@ApiProperty({ description: '搜索关键词（昵称、OpenID）', required: false })
	@IsOptional()
	@IsString()
	keyword?: string;

	@ApiProperty({ description: '账号状态（0-已封禁，1-正常）', required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	status?: number;
}
