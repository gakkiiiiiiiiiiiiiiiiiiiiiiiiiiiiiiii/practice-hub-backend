import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class CreateWithdrawalDto {
	@ApiProperty({ description: '申请提现金额（元）', example: 100 })
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	amount: number;

	@ApiProperty({ description: '支付宝账号' })
	@IsString()
	@MaxLength(120)
	alipay_account: string;

	@ApiProperty({ description: '支付宝实名' })
	@IsString()
	@MaxLength(50)
	real_name: string;
}
