import { Controller, Put, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { SetCountdownDto } from './dto/set-countdown.dto';
import { SetDailyQuotesDto } from './dto/set-daily-quotes.dto';
import { GetOperationLogsDto } from './dto/get-operation-logs.dto';
import { SetCheckinMinutesDto } from './dto/set-checkin-minutes.dto';
import { SetCourseCoverConfigDto } from './dto/set-course-cover-config.dto';
import { ReferralCouponService } from '../marketing/referral-coupon.service';

@ApiTags('系统管理')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SystemController {
  constructor(
    private readonly systemService: SystemService,
    private readonly referralCouponService: ReferralCouponService,
  ) {}

  @Put('settings/countdown')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置考研倒计时' })
  async setCountdown(@Body() dto: SetCountdownDto) {
    const result = await this.systemService.setCountdown(dto);
    return CommonResponseDto.success(result);
  }

  @Get('logs')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取操作日志列表' })
  async getOperationLogs(@Query() dto: GetOperationLogsDto) {
    const result = await this.systemService.getOperationLogs(dto);
    return CommonResponseDto.success(result);
  }

  @Get('settings/daily-quotes')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取广播消息列表' })
  async getDailyQuotes() {
    const result = await this.systemService.getDailyQuotes();
    return CommonResponseDto.success(result);
  }

  @Put('settings/daily-quotes')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置广播消息列表' })
  async setDailyQuotes(@Body() dto: SetDailyQuotesDto) {
    const result = await this.systemService.setDailyQuotes(dto);
    return CommonResponseDto.success(result);
  }

  @Get('settings/checkin-minutes')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取打卡时间配置' })
  async getCheckinMinutes() {
    const result = await this.systemService.getCheckinMinutes();
    return CommonResponseDto.success({ minutes: result });
  }

  @Put('settings/checkin-minutes')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置打卡时间配置' })
  async setCheckinMinutes(@Body() dto: SetCheckinMinutesDto) {
    const result = await this.systemService.setCheckinMinutes(dto.minutes);
    return CommonResponseDto.success(result);
  }

  @Get('settings/course-cover')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取课程自动生成封面配置' })
  async getCourseCoverConfig() {
    const result = await this.systemService.getCourseCoverConfig();
    return CommonResponseDto.success(result);
  }

  @Put('settings/course-cover')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置课程自动生成封面配置' })
  async setCourseCoverConfig(@Body() dto: SetCourseCoverConfigDto) {
    const result = await this.systemService.setCourseCoverConfig(dto);
    return CommonResponseDto.success(result);
  }

  @Get('settings/category-cover')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取分类自动生成封面配置' })
  async getCategoryCoverConfig() {
    const result = await this.systemService.getCategoryCoverConfig();
    return CommonResponseDto.success(result);
  }

  @Put('settings/category-cover')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置分类自动生成封面配置' })
  async setCategoryCoverConfig(@Body() dto: SetCourseCoverConfigDto) {
    const result = await this.systemService.setCategoryCoverConfig(dto);
    return CommonResponseDto.success(result);
  }

  @Get('settings/course-intro-template')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @ApiOperation({ summary: '获取课程介绍默认模板' })
  async getCourseIntroTemplate() {
    const result = await this.systemService.getCourseIntroTemplate();
    return CommonResponseDto.success({ template: result });
  }

  @Put('settings/course-intro-template')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @ApiOperation({ summary: '设置课程介绍默认模板' })
  async setCourseIntroTemplate(@Body() body: { template?: string }) {
    const result = await this.systemService.setCourseIntroTemplate(body?.template || '');
    return CommonResponseDto.success(result);
  }

  @Get('settings/faqs')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @ApiOperation({ summary: '获取小程序常见问题配置' })
  async getFaqConfig() {
    const result = await this.systemService.getFaqConfig();
    return CommonResponseDto.success(result);
  }

  @Put('settings/faqs')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
  @ApiOperation({ summary: '设置小程序常见问题配置' })
  async setFaqConfig(@Body() body: { items?: Array<{ question: string; answer: string }> }) {
    const result = await this.systemService.setFaqConfig(body?.items || []);
    return CommonResponseDto.success(result);
  }

  @Get('settings/referral-coupon')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取拉新优惠券配置' })
  async getReferralCouponConfig() {
    const result = await this.referralCouponService.getConfig();
    return CommonResponseDto.success(result);
  }

  @Put('settings/referral-coupon')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置拉新优惠券配置' })
  async setReferralCouponConfig(
    @Body()
    body: {
      enabled?: boolean;
      invite_count_per_reward?: number;
      coupon_amount?: number;
      coupon_min_amount?: number;
      max_coupons_per_user?: number;
      coupon_valid_days?: number | null;
    },
  ) {
    const result = await this.referralCouponService.setConfig(body || {});
    return CommonResponseDto.success(result);
  }
}
