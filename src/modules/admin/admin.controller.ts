import { Controller, Put, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@ApiTags('管理员')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Put(':id/status')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '封禁/解封小程序用户' })
  async updateUserStatus(@Param('id') id: number, @Body() dto: UpdateUserStatusDto) {
    const result = await this.adminService.updateUserStatus(+id, dto);
    return CommonResponseDto.success(result);
  }
}

