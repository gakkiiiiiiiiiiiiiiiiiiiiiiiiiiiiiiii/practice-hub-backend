import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('仪表盘')
@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '系统总览数据' })
  async getOverviewStats() {
    const result = await this.dashboardService.getOverviewStats();
    return CommonResponseDto.success(result);
  }

  @Get('agent')
  @Roles(AdminRole.AGENT)
  @ApiOperation({ summary: '代理商个人数据' })
  async getAgentStats(@CurrentUser() user: any) {
    const result = await this.dashboardService.getAgentStats(user.adminId);
    return CommonResponseDto.success(result);
  }
}

