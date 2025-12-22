import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AppLoginDto {
  @ApiProperty({ description: '微信登录 code', example: '081abc123def456' })
  @IsNotEmpty({ message: 'code 不能为空' })
  @IsString()
  code: string;
}

