import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { ActivationCodeTargetType } from '../../../database/entities/activation-code.entity';

class AppActivationCodeRewardPayloadDto {
	@ApiPropertyOptional({ description: '代理商等级：1-一级代理，2-二级代理，3-三级代理' })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(3)
	agent_level?: number;

	@ApiPropertyOptional({ description: '积分数量' })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(1000000)
	points_amount?: number;

	@ApiPropertyOptional({ description: '优惠券面额' })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	coupon_amount?: number;

	@ApiPropertyOptional({ description: '优惠券使用门槛' })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	coupon_min_amount?: number;

	@ApiPropertyOptional({ description: '优惠券有效天数；null 表示永久有效', nullable: true })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(3650)
	coupon_valid_days?: number | null;
}

export class GenerateAppActivationCodesDto {
	@ApiPropertyOptional({ description: '激活目标类型', enum: ActivationCodeTargetType })
	@IsOptional()
	@IsEnum(ActivationCodeTargetType)
	target_type?: ActivationCodeTargetType;

	@ApiPropertyOptional({ description: '目标 ID' })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	target_id?: number;

	@ApiPropertyOptional({ description: '课程 ID（兼容旧客户端）' })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	course_id?: number;

	@ApiProperty({ description: '生成数量', example: 10, minimum: 1, maximum: 10000 })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(10000)
	count: number;

	@ApiPropertyOptional({ type: AppActivationCodeRewardPayloadDto })
	@IsOptional()
	@ValidateNested()
	@Type(() => AppActivationCodeRewardPayloadDto)
	reward_payload?: AppActivationCodeRewardPayloadDto;
}
