import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateDistributionConfigDto {
	@ApiProperty({ description: '最大层级数', example: 3, minimum: 1, maximum: 10 })
	@IsOptional()
	@IsNumber()
	@Min(1)
	@Max(10)
	max_level?: number;

	@ApiProperty({ description: '各级分成比例（百分比）', example: [10, 5, 2] })
	@IsOptional()
	@IsArray()
	@IsNumber({}, { each: true })
	commission_rates?: number[];

	@ApiProperty({ description: '最低提现金额（元）', example: 10 })
	@IsOptional()
	@IsNumber()
	@Min(0)
	min_withdraw_amount?: number;

	@ApiProperty({ description: '是否启用分销系统', example: 1 })
	@IsOptional()
	@IsNumber()
	is_enabled?: number;

	@ApiProperty({ description: '分销说明', required: false })
	@IsOptional()
	@IsString()
	description?: string;
}

