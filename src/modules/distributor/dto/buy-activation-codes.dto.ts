import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class BuyActivationCodesDto {
	@ApiProperty({ description: '课程 ID', example: 1 })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	course_id: number;

	@ApiProperty({ description: '购买数量', example: 10, minimum: 1, maximum: 1000 })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(1000)
	count: number;
}
