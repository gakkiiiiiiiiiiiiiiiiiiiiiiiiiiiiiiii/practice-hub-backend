import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({ description: '业务订单号', example: 'ORDER17100000000000001' })
  @IsNotEmpty({ message: '订单号不能为空' })
  @IsString()
  order_no: string;
}
