import { Transform } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferCouponDto {
	@ApiProperty({ description: '接收方用户 ID', example: 123 })
	@Transform(({ value }) => parseInt(String(value), 10))
	@IsInt()
	@Min(1)
	target_user_id: number;
}
