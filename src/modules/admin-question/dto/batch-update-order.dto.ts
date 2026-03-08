import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class QuestionOrderItem {
	@ApiProperty()
	@IsNumber()
	id: number;

	@ApiProperty()
	@IsNumber()
	sort_order: number;
}

export class BatchUpdateOrderDto {
	@ApiProperty({ type: [QuestionOrderItem], description: '题目 id 与 序号 列表' })
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => QuestionOrderItem)
	orders: QuestionOrderItem[];
}
