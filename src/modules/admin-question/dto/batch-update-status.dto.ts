import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, ArrayMinSize, IsIn } from 'class-validator';

export class BatchUpdateStatusQuestionsDto {
	@ApiProperty({ description: '题目ID数组', type: [Number], example: [1, 2, 3] })
	@IsArray()
	@ArrayMinSize(1, { message: '至少选择一个题目' })
	@IsNumber({}, { each: true, message: '每个ID必须是数字' })
	ids: number[];

	@ApiProperty({ description: '状态：1=启用，0=禁用', enum: [0, 1], example: 1 })
	@IsIn([0, 1], { message: 'status 必须为 0 或 1' })
	status: number;
}
