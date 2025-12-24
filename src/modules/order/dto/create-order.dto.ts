import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ description: '课程ID', example: 1 })
  @IsNotEmpty({ message: '课程ID不能为空' })
  @IsNumber()
  course_id: number;
}

