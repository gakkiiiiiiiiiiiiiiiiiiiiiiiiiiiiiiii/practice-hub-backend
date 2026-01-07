import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum DistributorStatus {
	PENDING = 0, // 待审核
	APPROVED = 1, // 已通过
	REJECTED = 2, // 已拒绝
	DISABLED = 3, // 已禁用
}

export class UpdateDistributorStatusDto {
	@ApiProperty({ description: '状态', enum: DistributorStatus })
	@IsEnum(DistributorStatus)
	status: DistributorStatus;

	@ApiProperty({ description: '拒绝原因（状态为已拒绝时必填）', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	reject_reason?: string;
}

