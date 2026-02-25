import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, IsNumber, IsIn } from 'class-validator';

export class BatchUpdateStatusDto {
	@ApiProperty({ description: '课程ID列表', example: [1, 2, 3], type: [Number] })
	@IsNotEmpty({ message: '课程ID列表不能为空' })
	@IsArray({ message: '课程ID列表必须是数组' })
	@IsNumber({}, { each: true, message: '课程ID必须是数字' })
	ids: number[];

	@ApiProperty({ description: '状态：0-禁用，1-启用', example: 1, enum: [0, 1] })
	@IsNotEmpty({ message: '状态不能为空' })
	@IsNumber({}, { message: '状态必须是数字' })
	@IsIn([0, 1], { message: '状态只能是0（禁用）或1（启用）' })
	status: number;
}
