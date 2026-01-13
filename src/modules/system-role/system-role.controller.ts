import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRoleService } from './system-role.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { GetRoleListDto } from './dto/get-role-list.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@ApiTags('系统管理-角色管理')
@Controller('admin/roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN) // 只有超级管理员可以管理角色
export class SystemRoleController {
	constructor(private readonly systemRoleService: SystemRoleService) {}

	@Get()
	@ApiOperation({ summary: '获取角色列表' })
	async getRoleList(@Query() dto: GetRoleListDto) {
		const result = await this.systemRoleService.getRoleList(dto);
		return CommonResponseDto.success(result);
	}

	@Get('permissions')
	@ApiOperation({ summary: '获取所有权限列表（分组）' })
	async getPermissionGroups() {
		const result = await this.systemRoleService.getPermissionGroups();
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@ApiOperation({ summary: '获取角色详情' })
	async getRoleDetail(@Param('id') id: string) {
		// 支持通过ID或value查询
		const idNum = parseInt(id, 10);
		const result = await this.systemRoleService.getRoleDetail(isNaN(idNum) ? id : idNum);
		return CommonResponseDto.success(result);
	}

	@Post()
	@ApiOperation({ summary: '创建角色' })
	async createRole(@Body() dto: CreateRoleDto) {
		const result = await this.systemRoleService.createRole(dto);
		return CommonResponseDto.success(result);
	}

	@Put(':id/permissions')
	@ApiOperation({ summary: '更新角色权限' })
	async updateRolePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto) {
		// 支持通过ID或value更新
		const idNum = parseInt(id, 10);
		const result = await this.systemRoleService.updateRolePermissions(isNaN(idNum) ? id : idNum, dto);
		return CommonResponseDto.success(result);
	}

	@Delete(':id')
	@ApiOperation({ summary: '删除角色' })
	async deleteRole(@Param('id') id: number) {
		const result = await this.systemRoleService.deleteRole(+id);
		return CommonResponseDto.success(result);
	}
}
