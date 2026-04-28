import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({ description: '业务订单号', example: 'ORDER17100000000000001' })
  @IsNotEmpty({ message: '订单号不能为空' })
  @IsString()
  order_no: string;

  @ApiProperty({ description: '云函数查询微信支付结果后返回的支付证明', required: false })
  @IsOptional()
  @IsString()
  pay_proof?: string;
}
