import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class ToggleCollectionDto {
  @ApiProperty({ description: '题目ID', example: 1 })
  @IsNotEmpty({ message: '题目ID不能为空' })
  @IsNumber()
  question_id: number;
}

