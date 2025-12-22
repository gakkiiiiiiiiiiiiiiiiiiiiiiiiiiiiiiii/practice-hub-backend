import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ description: '题库ID', example: 1 })
  @IsNotEmpty({ message: '题库ID不能为空' })
  @IsNumber()
  subject_id: number;
}

