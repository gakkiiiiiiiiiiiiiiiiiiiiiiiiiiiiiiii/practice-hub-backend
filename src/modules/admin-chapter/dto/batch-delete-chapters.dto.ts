import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, IsNumber } from 'class-validator';

export class BatchDeleteChaptersDto {
	@ApiProperty({ description: '章节ID列表', example: [1, 2, 3], type: [Number] })
	@IsNotEmpty({ message: '章节ID列表不能为空' })
	@IsArray({ message: '章节ID列表必须是数组' })
	@IsNumber({}, { each: true, message: '章节ID必须是数字' })
	ids: number[];
}
