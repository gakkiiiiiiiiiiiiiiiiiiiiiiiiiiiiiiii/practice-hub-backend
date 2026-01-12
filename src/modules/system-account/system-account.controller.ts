import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemAccountService } from './system-account.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { GetAccountListDto } from './dto/get-account-list.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('系统管理-账号管理')
@Controller('admin/accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN) // 只有超级管理员可以管理账号
export class SystemAccountController {
	constructor(private readonly systemAccountService: SystemAccountService) {}

	@Get()
	@ApiOperation({ summary: '获取账号列表' })
	async getAccountList(@Query() dto: GetAccountListDto) {
		const result = await this.systemAccountService.getAccountList(dto);
		return CommonResponseDto.success(result);
	}

	@Get(':id')
	@ApiOperation({ summary: '获取账号详情' })
	async getAccountDetail(@Param('id') id: number) {
		const result = await this.systemAccountService.getAccountDetail(+id);
		return CommonResponseDto.success(result);
	}

	@Post()
	@ApiOperation({ summary: '创建账号' })
	async createAccount(@Body() dto: CreateAccountDto) {
		const result = await this.systemAccountService.createAccount(dto);
		return CommonResponseDto.success(result);
	}

	@Put(':id')
	@ApiOperation({ summary: '更新账号' })
	async updateAccount(
		@Param('id') id: number,
		@Body() dto: UpdateAccountDto,
		@CurrentUser() currentUser: any,
	) {
		// 不能禁用或删除自己
		if (currentUser.adminId === +id && dto.status === 0) {
			throw new BadRequestException('不能禁用自己的账号');
		}
		const result = await this.systemAccountService.updateAccount(+id, dto);
		return CommonResponseDto.success(result);
	}

	@Delete(':id')
	@ApiOperation({ summary: '删除账号' })
	async deleteAccount(@Param('id') id: number, @CurrentUser() currentUser: any) {
		// 不能删除自己
		if (currentUser.adminId === +id) {
			throw new BadRequestException('不能删除自己的账号');
		}
		const result = await this.systemAccountService.deleteAccount(+id);
		return CommonResponseDto.success(result);
	}
}
