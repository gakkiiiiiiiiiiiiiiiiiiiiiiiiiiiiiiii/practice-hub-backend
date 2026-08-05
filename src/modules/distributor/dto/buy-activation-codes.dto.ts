import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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

	@ApiPropertyOptional({ description: '旧版小程序兼容字段', enum: ['course'] })
	@IsOptional()
	@IsIn(['course'])
	target_type?: 'course';

	@ApiPropertyOptional({ description: '旧版小程序兼容字段，实际购买目标仍以 course_id 为准' })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	target_id?: number;
}
