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

	@ApiProperty({ description: '初中高三级基础佣金比例', example: [20, 25, 30], required: false })
	@IsOptional()
	@IsArray()
	@IsNumber({}, { each: true })
	base_commission_rates?: number[];

	@ApiProperty({ description: '初中高三级直推团队佣金比例', example: [5, 6, 8], required: false })
	@IsOptional()
	@IsArray()
	@IsNumber({}, { each: true })
	direct_commission_rates?: number[];

	@ApiProperty({ description: '初中高三级间推团队佣金比例', example: [0, 3, 4], required: false })
	@IsOptional()
	@IsArray()
	@IsNumber({}, { each: true })
	indirect_commission_rates?: number[];

	@ApiProperty({ description: '最低提现金额（元）', example: 10 })
	@IsOptional()
	@IsNumber()
	@Min(0)
	min_withdraw_amount?: number;

	@ApiProperty({ description: '提现后最低保留金额', example: 20, required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	withdraw_reserve_amount?: number;

	@ApiProperty({ description: '提现手续费比例（百分比）', example: 5, required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(100)
	withdraw_fee_rate?: number;

	@ApiProperty({ description: '佣金冻结天数', example: 15, required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(365)
	commission_freeze_days?: number;

	@ApiProperty({ description: '每种纸质资料固定佣金', example: 1, required: false })
	@IsOptional()
	@IsNumber()
	@Min(0)
	paper_commission_per_kind?: number;

	@ApiProperty({ description: '是否启用分销系统', example: 1 })
	@IsOptional()
	@IsNumber()
	is_enabled?: number;

	@ApiProperty({ description: '分销说明', required: false })
	@IsOptional()
	@IsString()
	description?: string;
}
