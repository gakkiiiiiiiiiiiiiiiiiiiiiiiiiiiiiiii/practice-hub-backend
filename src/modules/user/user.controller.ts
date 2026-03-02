import { Controller, Get, Put, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CheckinService } from './checkin.service';
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
  constructor(
    private readonly userService: UserService,
    private readonly checkinService: CheckinService,
  ) {}

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

  @Get('checkin/status')
  @ApiOperation({ summary: '获取今日打卡状态' })
  async getTodayCheckinStatus(@CurrentUser() user: any) {
    const result = await this.checkinService.getTodayCheckinStatus(user.userId);
    return CommonResponseDto.success(result);
  }

  @Get('checkin/minutes')
  @ApiOperation({ summary: '获取打卡所需时间' })
  async getCheckinMinutes() {
    const result = await this.checkinService.getCheckinMinutes();
    return CommonResponseDto.success({ minutes: result });
  }

  @Post('checkin')
  @ApiOperation({ summary: '打卡' })
  async checkin(
    @CurrentUser() user: any,
    @Body() body: { studyDuration: number; questionCount: number },
  ) {
    const result = await this.checkinService.checkin(
      user.userId,
      body.studyDuration,
      body.questionCount || 0,
    );
    return CommonResponseDto.success(result);
  }

  @Get('checkin/list')
  @ApiOperation({ summary: '获取打卡记录列表' })
  async getCheckinList(
    @CurrentUser() user: any,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    const result = await this.checkinService.getUserCheckins(
      user.userId,
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );
    return CommonResponseDto.success(result);
  }
}

