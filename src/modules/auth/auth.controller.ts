import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { AppLoginDto } from './dto/app-login.dto';
import { AppPhoneLoginDto } from './dto/app-phone-login.dto';
import { AdminLoginDto } from './dto/admin-login.dto';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('app/login')
  @ApiOperation({ summary: '小程序端 - 微信一键登录' })
  async appLogin(@Body() dto: AppLoginDto) {
    const result = await this.authService.appLogin(dto.code, dto.distributor_code, {
      nickname: dto.nickname || dto.nickName || dto.userInfo?.nickName,
      avatar: dto.avatar || dto.avatarUrl || dto.userInfo?.avatarUrl,
    });
    return CommonResponseDto.success(result);
  }

  @Post('app/phone-login')
  @ApiOperation({ summary: '小程序端 - 手机号快捷登录' })
  async appPhoneLogin(@Body() dto: AppPhoneLoginDto) {
    const result = await this.authService.appPhoneLogin(dto.loginCode, dto.phoneCode, dto.distributor_code, {
      nickname: dto.nickname || dto.nickName || dto.userInfo?.nickName,
      avatar: dto.avatar || dto.avatarUrl || dto.userInfo?.avatarUrl,
    });
    return CommonResponseDto.success(result);
  }

  @Post('admin/login')
  @ApiOperation({ summary: '管理后台 - 账号密码登录' })
  async adminLogin(@Body() dto: AdminLoginDto) {
    const result = await this.authService.adminLogin(dto.username, dto.password);
    return CommonResponseDto.success(result);
  }

  @Get('admin/info')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前管理员信息' })
  async getAdminInfo(@CurrentUser() user: any) {
    const permissions = await this.authService.getPermissionsByRole(user.role);
    return CommonResponseDto.success({
      id: user.adminId,
      role: user.role,
      permissions,
    });
  }
}
