import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DistributorWithdrawalStatus } from '../../../database/entities/distributor-withdrawal.entity';

export class UpdateWithdrawalStatusDto {
	@ApiProperty({ enum: [DistributorWithdrawalStatus.PAID, DistributorWithdrawalStatus.REJECTED] })
	@IsEnum(DistributorWithdrawalStatus)
	status: DistributorWithdrawalStatus;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	remark?: string;
}
