import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class StartExamDto {
	@ApiProperty({ description: '考试配置ID', example: 1 })
	@IsNotEmpty({ message: '考试配置ID不能为空' })
	@IsNumber()
	exam_config_id: number;
}
