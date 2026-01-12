import { Controller, Put, Get, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { GetUserListDto } from './dto/get-user-list.dto';

@ApiTags('管理员-小程序用户管理')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN)
export class AdminController {
	constructor(private readonly adminService: AdminService) {}

	@Get()
	@ApiOperation({ summary: '获取小程序用户列表' })
	async getUserList(@Query() dto: GetUserListDto) {
		const result = await this.adminService.getUserList(dto);
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@ApiOperation({ summary: '获取小程序用户详情' })
	async getUserDetail(@Param('id') id: number) {
		const result = await this.adminService.getUserDetail(+id);
		return CommonResponseDto.success(result);
	}

	@Put(':id/status')
	@ApiOperation({ summary: '封禁/解封小程序用户' })
	async updateUserStatus(@Param('id') id: number, @Body() dto: UpdateUserStatusDto) {
		const result = await this.adminService.updateUserStatus(+id, dto);
		return CommonResponseDto.success(result);
	}
}

