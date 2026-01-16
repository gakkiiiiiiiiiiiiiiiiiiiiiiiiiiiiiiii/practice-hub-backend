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

@ApiTags('系统管理')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

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
  async getOperationLogs(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    const result = await this.systemService.getOperationLogs(page, pageSize);
    return CommonResponseDto.success(result);
  }

  @Get('settings/daily-quotes')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取每日提示语列表' })
  async getDailyQuotes() {
    const result = await this.systemService.getDailyQuotes();
    return CommonResponseDto.success(result);
  }

  @Put('settings/daily-quotes')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '设置每日提示语列表' })
  async setDailyQuotes(@Body() dto: SetDailyQuotesDto) {
    const result = await this.systemService.setDailyQuotes(dto);
    return CommonResponseDto.success(result);
  }
}

