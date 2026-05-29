import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateCartOrderDto {
	@ApiProperty({ description: '课程 ID 列表', type: [Number], example: [1, 2] })
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(20)
	@Type(() => Number)
	@IsNumber({}, { each: true })
	@Transform(({ value }) => {
		if (!Array.isArray(value)) {
			return [];
		}
		return [...new Set(value.map((item) => parseInt(String(item), 10)).filter((item) => item > 0))];
	})
	course_ids: number[];

	@ApiPropertyOptional({ description: '优惠券 ID' })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		return parseInt(String(value), 10);
	})
	@IsNumber()
	coupon_id?: number;
}
