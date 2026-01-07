import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AppLoginDto {
  @ApiProperty({ description: '微信登录 code', example: '081abc123def456' })
  @IsNotEmpty({ message: 'code 不能为空' })
  @IsString()
  code: string;

  @ApiProperty({ description: '分销商编号（通过分享二维码注册时传递）', required: false })
  @IsOptional()
  @IsString()
  distributor_code?: string;
}

