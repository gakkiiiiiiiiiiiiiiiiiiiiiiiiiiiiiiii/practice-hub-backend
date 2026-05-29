import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetAdminCouponListDto {
	@ApiProperty({ required: false, default: 1 })
	@IsOptional()
	@Transform(({ value }) => {
		const num = parseInt(String(value ?? 1), 10);
		return Number.isFinite(num) && num >= 1 ? num : 1;
	})
	@IsNumber()
	@Min(1)
	page?: number;

	@ApiProperty({ required: false, default: 10 })
	@IsOptional()
	@Transform(({ value }) => {
		const num = parseInt(String(value ?? 10), 10);
		return Number.isFinite(num) && num >= 1 ? num : 10;
	})
	@IsNumber()
	@Min(1)
	pageSize?: number;

	@ApiProperty({ description: '用户昵称或 OpenID', required: false })
	@IsOptional()
	@IsString()
	keyword?: string;

	@ApiProperty({ description: '指定用户 ID', required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const num = parseInt(String(value), 10);
		return Number.isFinite(num) && num >= 1 ? num : undefined;
	})
	@IsNumber()
	user_id?: number;

	@ApiProperty({ description: '状态 unused/used/expired', required: false })
	@IsOptional()
	@IsIn(['unused', 'used', 'expired'])
	status?: 'unused' | 'used' | 'expired';

	@ApiProperty({ description: '来源 referral/admin', required: false })
	@IsOptional()
	@IsString()
	source?: string;
}
