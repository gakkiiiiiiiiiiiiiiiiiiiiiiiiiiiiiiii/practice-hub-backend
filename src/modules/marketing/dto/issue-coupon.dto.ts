import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeThresholdYuan } from '../../../common/utils/price.util';

export class IssueCouponDto {
	@ApiProperty({ description: '小程序用户 ID' })
	@Transform(({ value }) => parseInt(String(value), 10))
	@IsInt()
	@Min(1)
	user_id: number;

	@ApiProperty({ description: '优惠券面额（元）', example: 5 })
	@Transform(({ value }) => Number(value))
	@IsNumber()
	@Min(1)
	amount: number;

	@ApiProperty({ description: '使用门槛（元），0 表示无门槛', example: 0, required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return 0;
		}
		return normalizeThresholdYuan(Number(value));
	})
	@IsNumber()
	@Min(0)
	min_amount?: number;

	@ApiProperty({ description: '发放张数', example: 1, required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return 1;
		}
		return parseInt(String(value), 10);
	})
	@IsInt()
	@Min(1)
	@Max(50)
	count?: number;

	@ApiProperty({ description: '有效天数，不传或 null 表示永久有效', required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return null;
		}
		return parseInt(String(value), 10);
	})
	@ValidateIf((_, value) => value !== null && value !== undefined)
	@IsInt()
	@Min(1)
	valid_days?: number | null;
}
