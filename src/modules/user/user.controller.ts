import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';

@ApiTags('用户')
@Controller('app/user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('info')
  @ApiOperation({ summary: '获取个人信息' })
  async getUserInfo(@CurrentUser() user: any) {
    const result = await this.userService.getUserInfo(user.userId);
    return CommonResponseDto.success(result);
  }

  @Put('profile')
  @ApiOperation({ summary: '更新个人信息' })
  async updateProfile(@CurrentUser() user: any, @Body() dto: UpdateUserProfileDto) {
    const result = await this.userService.updateProfile(user.userId, dto);
    return CommonResponseDto.success(result);
  }

  @Post('bind_phone')
  @ApiOperation({ summary: '绑定手机号' })
  async bindPhone(@CurrentUser() user: any, @Body() dto: BindPhoneDto) {
    const result = await this.userService.bindPhone(user.userId, dto);
    return CommonResponseDto.success(result);
  }
}

