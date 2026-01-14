import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray, ArrayMinSize, ValidateIf } from 'class-validator';

export class UpdateRecommendationsDto {
	@ApiProperty({ description: '课程ID，不传或传null表示公共配置', required: false, type: Number, nullable: true })
	@IsOptional()
	@ValidateIf((o) => o.courseId !== null && o.courseId !== undefined)
	@IsNumber({}, { message: 'courseId 必须是数字' })
	courseId?: number | null;

	@ApiProperty({ description: '推荐课程ID列表', type: [Number] })
	@IsArray({ message: 'recommendedCourseIds 必须是数组' })
	@ArrayMinSize(1, { message: '至少选择一个推荐课程' })
	@IsNumber({}, { each: true, message: '推荐课程ID必须是数字' })
	recommendedCourseIds: number[];
}
