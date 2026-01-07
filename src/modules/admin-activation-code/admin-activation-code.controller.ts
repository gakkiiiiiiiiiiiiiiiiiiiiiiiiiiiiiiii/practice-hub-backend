import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  Res,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminActivationCodeService } from './admin-activation-code.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { GenerateCodeDto } from './dto/generate-code.dto';
import { GetCodeListDto } from './dto/get-code-list.dto';
import { ActivationCodeStatus } from '../../database/entities/activation-code.entity';

@ApiTags('管理后台-激活码管理')
@Controller('admin/codes')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
export class AdminActivationCodeController {
  constructor(private readonly adminActivationCodeService: AdminActivationCodeService) {}

  @Post('generate')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '生成激活码' })
  async generateCodes(@CurrentUser() user: any, @Body() dto: GenerateCodeDto) {
    const result = await this.adminActivationCodeService.generateCodes(user.adminId, dto);
    return CommonResponseDto.success(result);
  }

  @Get('statistics')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '激活码统计' })
  async getCodeStatistics(@CurrentUser() user: any) {
    const result = await this.adminActivationCodeService.getCodeStatistics(user.adminId, user.role);
    return CommonResponseDto.success(result);
  }

  @Get('export')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '导出激活码' })
  async exportCodes(
    @CurrentUser() user: any,
    @Query('batchNo') batchNo?: string,
    @Query('status') status?: ActivationCodeStatus,
    @Res() res?: Response,
  ) {
    const buffer = await this.adminActivationCodeService.exportCodes(
      user.adminId,
      user.role,
      batchNo,
      status,
    );
    const filename = batchNo ? `激活码_${batchNo}.xlsx` : 'activation_codes.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(filename)}`);
    res.send(buffer);
  }

  @Get()
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '激活码列表' })
  async getCodeList(
    @CurrentUser() user: any,
    @Query() dto: GetCodeListDto,
  ) {
    const result = await this.adminActivationCodeService.getCodeList(
      user.adminId,
      user.role,
      dto.page || 1,
      dto.pageSize || 20,
      dto.batchNo,
      dto.status,
    );
    return CommonResponseDto.success(result);
  }

  @Get(':id')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '激活码详情' })
  async getCodeDetail(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.adminActivationCodeService.getCodeDetail(id, user.adminId, user.role);
    return CommonResponseDto.success(result);
  }

  @Delete(':id')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '删除激活码' })
  async deleteCode(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.adminActivationCodeService.deleteCode(id, user.adminId, user.role);
    return CommonResponseDto.success(result);
  }
}

