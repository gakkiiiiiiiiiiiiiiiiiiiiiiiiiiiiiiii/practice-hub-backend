import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  Res,
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

  @Get()
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '激活码列表' })
  async getCodeList(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.adminActivationCodeService.getCodeList(
      user.adminId,
      user.role,
      page ? +page : 1,
      pageSize ? +pageSize : 20,
    );
    return CommonResponseDto.success(result);
  }

  @Get('export')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.AGENT)
  @ApiOperation({ summary: '导出激活码' })
  async exportCodes(@CurrentUser() user: any, @Res() res: Response) {
    const buffer = await this.adminActivationCodeService.exportCodes(user.adminId, user.role);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=activation_codes.xlsx');
    res.send(buffer);
  }
}

