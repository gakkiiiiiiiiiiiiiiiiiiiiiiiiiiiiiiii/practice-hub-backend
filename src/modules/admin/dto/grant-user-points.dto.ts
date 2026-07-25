import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantUserPointsDto {
	@ApiProperty({ description: '赠送积分数量', example: 100 })
	@Transform(({ value }) => parseInt(String(value), 10))
	@IsInt()
	@Min(1)
	@Max(1000000)
	amount: number;

	@ApiProperty({ description: '赠送备注', required: false, example: '活动奖励' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	remark?: string;
}
