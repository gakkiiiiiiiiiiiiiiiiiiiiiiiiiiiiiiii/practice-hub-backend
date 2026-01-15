import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BuyCodeDto {
  @ApiProperty({ description: '课程ID', example: 1 })
  @IsNotEmpty({ message: '课程ID不能为空' })
  @Type(() => Number)
  @IsNumber()
  courseId: number;

  @ApiProperty({ description: '购买数量', example: 10 })
  @IsNotEmpty({ message: '购买数量不能为空' })
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: '购买数量必须大于0' })
  count: number;
}
