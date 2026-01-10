import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, ArrayMinSize } from 'class-validator';

export class BatchDeleteQuestionsDto {
	@ApiProperty({ description: '题目ID数组', type: [Number], example: [1, 2, 3] })
	@IsArray()
	@ArrayMinSize(1, { message: '至少选择一个题目' })
	@IsNumber({}, { each: true, message: '每个ID必须是数字' })
	ids: number[];
}
