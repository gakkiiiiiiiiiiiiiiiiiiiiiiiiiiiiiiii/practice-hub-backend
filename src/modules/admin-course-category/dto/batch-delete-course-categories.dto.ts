import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber } from 'class-validator';

export class BatchDeleteCourseCategoriesDto {
	@ApiProperty({ description: '分类ID列表', example: [1, 2, 3], type: [Number] })
	@IsNotEmpty({ message: '分类ID列表不能为空' })
	@IsArray({ message: '分类ID列表必须是数组' })
	@IsNumber({}, { each: true, message: '分类ID必须是数字' })
	ids: number[];
}
