import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RedeemCodeDto {
  @ApiProperty({ description: '激活码', example: 'ABC123DEF456' })
  @IsNotEmpty({ message: '激活码不能为空' })
  @IsString()
  code: string;
}

