import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateRecommendationsDto {
	@ApiProperty({ description: '课程ID，不传或传null表示公共配置', required: false })
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	courseId?: number | null;

	@ApiProperty({ description: '推荐课程ID列表', type: [Number] })
	@IsArray()
	@ArrayMinSize(1)
	@IsNumber({}, { each: true })
	@Type(() => Number)
	recommendedCourseIds: number[];
}
