import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsArray } from 'class-validator';

export class SubmitAnswerDto {
  @ApiProperty({ description: '题目ID', example: 1 })
  @IsNotEmpty({ message: '题目ID不能为空' })
  @IsNumber()
  qid: number;

  @ApiProperty({ description: '用户答案', example: ['A'] })
  @IsNotEmpty({ message: '答案不能为空' })
  @IsArray()
  options: string[];
}

