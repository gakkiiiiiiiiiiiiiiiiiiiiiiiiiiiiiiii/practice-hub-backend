import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CloudPrintService } from './cloud-print.service';
import { UpdateCloudPrintConfigDto } from './dto/update-cloud-print-config.dto';
import { SubmitCloudPrintDto } from './dto/submit-cloud-print.dto';

@ApiTags('云打印管理')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminCloudPrintController {
  constructor(private readonly cloudPrintService: CloudPrintService) {}

  @Get('settings/cloud-print')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取云打印开关和默认打印参数' })
  async getConfig() {
    return CommonResponseDto.success(await this.cloudPrintService.getConfig());
  }

  @Put('settings/cloud-print')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '更新云打印开关和默认打印参数' })
  async updateConfig(@Body() dto: UpdateCloudPrintConfigDto) {
    return CommonResponseDto.success(await this.cloudPrintService.updateConfig(dto));
  }

  @Post('orders/:id/cloud-print')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '手动创建并推进纸质资料云打印任务' })
  async submitOrder(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitCloudPrintDto,
  ) {
    return CommonResponseDto.success(
      await this.cloudPrintService.enqueueAndProcessManual(
        id,
        user.userId || user.adminId,
        dto.expectedTotalAmountCents,
      ),
    );
  }

  @Get('orders/:id/cloud-print')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取订单云打印状态' })
  async getOrderJob(@Param('id', ParseIntPipe) id: number) {
    return CommonResponseDto.success(await this.cloudPrintService.getOrderJob(id));
  }

  @Post('orders/:id/cloud-print/confirm-cancelled')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '确认供应商未创建或已取消云打印订单，并预留退款' })
  async confirmCancelled(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return CommonResponseDto.success(
      await this.cloudPrintService.confirmProviderCancelled(id, user.userId || user.adminId),
    );
  }
}

@ApiTags('云打印回调')
@Controller('app/cloud-print')
export class CloudPrintCallbackController {
  constructor(private readonly cloudPrintService: CloudPrintService) {}

  @Post('callback')
  @ApiOperation({ summary: '刺猬云印订单状态回调' })
  async callback(
    @Headers() headers: Record<string, any>,
    @Body() body: Record<string, any>,
    @Query('token') token?: string,
  ) {
    return this.cloudPrintService.handleCallback(headers, body, token);
  }
}
