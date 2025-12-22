import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class RemoveWrongQuestionDto {
  @ApiProperty({ description: '错题本ID', example: 1 })
  @IsNotEmpty({ message: 'ID不能为空' })
  @IsNumber()
  id: number;
}

