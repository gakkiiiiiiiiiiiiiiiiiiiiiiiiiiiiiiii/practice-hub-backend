import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AppRegisterDto {
  @ApiProperty({ description: '用户名（4-20位字母数字下划线）', example: 'student01' })
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString()
  @MinLength(4, { message: '用户名至少4个字符' })
  @MaxLength(20, { message: '用户名最多20个字符' })
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能包含字母、数字和下划线' })
  username: string;

  @ApiProperty({ description: '密码（6-32位）', example: '123456' })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  @MaxLength(32, { message: '密码最多32位' })
  password: string;

  @ApiPropertyOptional({ description: '昵称' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '昵称最多50个字符' })
  nickname?: string;

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

  @ApiPropertyOptional({ description: '邀请人用户ID（拉新活动）' })
  @IsOptional()
  @IsString()
  referral_user_id?: string;
}
