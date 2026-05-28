import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AppPasswordLoginDto {
  @ApiProperty({ description: '用户名' })
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString()
  @MaxLength(20)
  username: string;

  @ApiProperty({ description: '密码' })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString()
  @MaxLength(32)
  password: string;

  @ApiProperty({ description: '设备唯一标识（客户端生成并持久化）' })
  @IsNotEmpty({ message: '设备标识不能为空' })
  @IsString()
  @MaxLength(64)
  device_id: string;

  @ApiPropertyOptional({ description: '设备名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  device_name?: string;

  @ApiPropertyOptional({ description: '平台，如 ios / android / ipad' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  platform?: string;
}
