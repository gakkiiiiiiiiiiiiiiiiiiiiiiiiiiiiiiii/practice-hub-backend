import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray, ArrayMinSize } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateRecommendationsDto {
	@ApiProperty({ description: '课程ID，不传或传null表示公共配置', required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === null || value === undefined || value === '') {
			return null;
		}
		const num = Number(value);
		return isNaN(num) ? null : num;
	})
	@IsNumber({}, { message: 'courseId 必须是数字' })
	courseId?: number | null;

	@ApiProperty({ description: '推荐课程ID列表', type: [Number] })
	@IsArray({ message: 'recommendedCourseIds 必须是数组' })
	@ArrayMinSize(1, { message: '至少选择一个推荐课程' })
	@Transform(({ value }) => {
		if (!Array.isArray(value)) {
			return [];
		}
		return value.map((item: any) => {
			const num = Number(item);
			return isNaN(num) ? null : num;
		}).filter((item: any) => item !== null);
	})
	@IsNumber({}, { each: true, message: '推荐课程ID必须是数字' })
	recommendedCourseIds: number[];
}
