import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, IsNumber } from 'class-validator';

export class BatchDeleteCoursesDto {
	@ApiProperty({ description: '课程ID列表', example: [1, 2, 3], type: [Number] })
	@IsNotEmpty({ message: '课程ID列表不能为空' })
	@IsArray({ message: '课程ID列表必须是数组' })
	@IsNumber({}, { each: true, message: '课程ID必须是数字' })
	ids: number[];
}
