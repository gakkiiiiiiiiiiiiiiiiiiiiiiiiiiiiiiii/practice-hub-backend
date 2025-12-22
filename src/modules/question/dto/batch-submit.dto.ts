import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AnswerItem {
  @ApiProperty({ description: '题目ID', example: 1 })
  @IsNotEmpty()
  qid: number;

  @ApiProperty({ description: '用户答案', example: ['A'] })
  @IsNotEmpty()
  @IsArray()
  options: string[];
}

export class BatchSubmitDto {
  @ApiProperty({ description: '答案列表', type: [AnswerItem] })
  @IsNotEmpty({ message: '答案列表不能为空' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerItem)
  answers: AnswerItem[];
}

