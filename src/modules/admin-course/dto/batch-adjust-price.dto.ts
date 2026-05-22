import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class BatchAdjustCoursePriceDto {
  @ApiProperty({ description: '课程ID列表', example: [1, 2, 3], type: [Number] })
  @IsNotEmpty({ message: '课程ID列表不能为空' })
  @IsArray({ message: '课程ID列表必须是数组' })
  @IsNumber({}, { each: true, message: '课程ID必须是数字' })
  ids: number[];

  @ApiProperty({
    description: '调价方式：delta=加减金额，percent=百分比，fixed=固定价格',
    example: 'delta',
    enum: ['delta', 'percent', 'fixed'],
  })
  @IsNotEmpty({ message: '调价方式不能为空' })
  @IsIn(['delta', 'percent', 'fixed'], { message: '调价方式只能是 delta、percent 或 fixed' })
  mode: 'delta' | 'percent' | 'fixed';

  @ApiProperty({ description: '调价值：金额/百分比/固定价格', example: 1 })
  @IsNotEmpty({ message: '调价值不能为空' })
  @IsNumber({}, { message: '调价值必须是数字' })
  value: number;

  @ApiProperty({
    description: '调价字段：price=用户售价，agent_price=代理商售价，both=两者',
    example: 'both',
    enum: ['price', 'agent_price', 'both'],
    required: false,
  })
  @IsOptional()
  @IsIn(['price', 'agent_price', 'both'], { message: '调价字段只能是 price、agent_price 或 both' })
  fields?: 'price' | 'agent_price' | 'both';
}
