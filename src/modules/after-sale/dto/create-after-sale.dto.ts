import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, MaxLength } from 'class-validator';

export class CreateAfterSaleDto {
  @ApiProperty({ description: '订单ID', example: 1 })
  @IsNotEmpty({ message: '订单ID不能为空' })
  @IsNumber()
  order_id: number;

  @ApiProperty({ description: '售后原因', example: '课程内容不符合预期' })
  @IsNotEmpty({ message: '售后原因不能为空' })
  @IsString()
  @MaxLength(500, { message: '售后原因不能超过500个字符' })
  reason: string;

  @ApiProperty({ description: '详细描述', example: '课程内容与描述不符，希望申请退款', required: false })
  @IsString()
  description?: string;
}
