import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsIn } from 'class-validator';

export class ProcessAfterSaleDto {
  @ApiProperty({ description: '处理状态：1-已处理，2-已拒绝', example: 1 })
  @IsNotEmpty({ message: '处理状态不能为空' })
  @IsNumber()
  @IsIn([1, 2], { message: '处理状态只能是1（已处理）或2（已拒绝）' })
  status: number;

  @ApiProperty({ description: '管理员回复', example: '已处理，已退款', required: false })
  @IsString()
  admin_reply?: string;
}
