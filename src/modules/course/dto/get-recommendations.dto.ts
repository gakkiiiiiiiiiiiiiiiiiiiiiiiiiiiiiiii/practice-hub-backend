import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRecommendationsDto {
	@ApiProperty({ description: '课程ID', required: false })
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	courseId?: number;
}
