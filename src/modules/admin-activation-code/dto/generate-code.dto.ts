import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export class GenerateCodeDto {
  @ApiProperty({ description: '课程ID', example: 1 })
  @IsNotEmpty({ message: '课程ID不能为空' })
  @IsNumber()
  course_id: number;

  @ApiProperty({ description: '生成数量', example: 100 })
  @IsNotEmpty({ message: '生成数量不能为空' })
  @IsNumber()
  @Min(1, { message: '生成数量必须大于0' })
  count: number;

  @ApiProperty({ description: '单价（可选，用于扣除余额）', example: 0.1, required: false })
  @IsOptional()
  @IsNumber()
  price?: number;
}

