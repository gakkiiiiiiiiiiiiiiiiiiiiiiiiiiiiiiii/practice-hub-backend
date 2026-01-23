import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetOperationLogsDto {
	@ApiProperty({ description: '页码', required: false, default: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	page?: number = 1;

	@ApiProperty({ description: '每页数量', required: false, default: 20 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	pageSize?: number = 20;

	@ApiProperty({ description: '搜索关键词（模块、操作、管理员用户名）', required: false })
	@IsOptional()
	@IsString()
	keyword?: string;

	@ApiProperty({ description: '操作模块', required: false })
	@IsOptional()
	@IsString()
	module?: string;

	@ApiProperty({ description: '操作类型', required: false })
	@IsOptional()
	@IsString()
	action?: string;

	@ApiProperty({ description: '管理员ID', required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	adminId?: number;

	@ApiProperty({ description: '操作人用户名', required: false })
	@IsOptional()
	@IsString()
	adminUsername?: string;

	@ApiProperty({ description: '操作用户类型（角色名称）', required: false })
	@IsOptional()
	@IsString()
	userType?: string;

	@ApiProperty({ description: '开始时间', required: false })
	@IsOptional()
	@IsDateString()
	startTime?: string;

	@ApiProperty({ description: '结束时间', required: false })
	@IsOptional()
	@IsDateString()
	endTime?: string;
}
