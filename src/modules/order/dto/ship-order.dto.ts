import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ShipOrderDto {
  @ApiProperty({ description: '物流运单号', example: 'SF1234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  tracking_no: string;

  @ApiPropertyOptional({ description: '物流公司编码，留空时尝试通过运单号自动识别', example: 'SF' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  shipper_code?: string;

  @ApiPropertyOptional({ description: '物流公司名称', example: '顺丰速运' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  shipper_name?: string;

  @ApiPropertyOptional({ description: '发货备注', example: '后台录入' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}
