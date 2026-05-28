import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class AppPhoneLoginDto {
  @ApiProperty({ description: 'wx.login 返回的登录 code' })
  @IsNotEmpty({ message: 'loginCode 不能为空' })
  @IsString()
  loginCode: string;

  @ApiProperty({ description: 'getPhoneNumber 返回的手机号授权 code' })
  @IsNotEmpty({ message: 'phoneCode 不能为空' })
  @IsString()
  phoneCode: string;

  @ApiProperty({ description: '分销商编号（通过分享二维码注册时传递）', required: false })
  @IsOptional()
  @IsString()
  distributor_code?: string;

  @ApiProperty({ description: '邀请人用户ID（拉新活动）', required: false })
  @IsOptional()
  @IsString()
  referral_user_id?: string;

  @ApiProperty({ description: '微信昵称', required: false })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiProperty({ description: '微信昵称（兼容微信字段名）', required: false })
  @IsOptional()
  @IsString()
  nickName?: string;

  @ApiProperty({ description: '微信头像地址', required: false })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiProperty({ description: '微信头像地址（兼容微信字段名）', required: false })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({ description: '微信用户资料对象', required: false })
  @IsOptional()
  @IsObject()
  userInfo?: {
    nickName?: string;
    avatarUrl?: string;
  };
}
