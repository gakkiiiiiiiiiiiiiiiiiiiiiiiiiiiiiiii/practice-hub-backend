import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundOrderDto {
  @ApiProperty({ description: '退款备注', required: false, example: '用户申请售后，同意退款' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
