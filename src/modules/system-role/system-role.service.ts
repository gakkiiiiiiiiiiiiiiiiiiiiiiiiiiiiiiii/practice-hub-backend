import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { AuthService } from '../auth/auth.service';
import { GetRoleListDto } from './dto/get-role-list.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Injectable()
export class SystemRoleService {
	// 默认角色配置（代理商、题库管理员）
	private readonly defaultRoles = [
		{
			id: 1,
			value: AdminRole.AGENT,
			name: '代理商',
			description: '代理商角色，可以管理激活码和查看资金记录',
			isDefault: true,
			isSystem: false, // 可以编辑权限
		},
		{
			id: 2,
			value: AdminRole.CONTENT_ADMIN,
			name: '题库管理员',
			description: '题库管理员角色，可以管理课程、章节和题目',
			isDefault: true,
			isSystem: false, // 可以编辑权限
		},
		{
			id: 3,
			value: AdminRole.SUPER_ADMIN,
			name: '系统管理员',
			description: '系统管理员角色，拥有所有权限',
			isDefault: true,
			isSystem: true, // 系统角色，不能编辑权限
		},
	];

	constructor(private readonly authService: AuthService) {}

	/**
	 * 获取角色列表
	 */
	async getRoleList(dto: GetRoleListDto) {
		const { page = 1, pageSize = 10 } = dto;
		const skip = (page - 1) * pageSize;

		// 获取所有角色的权限配置
		const roles = this.defaultRoles.map((role) => {
			const permissions = this.authService.getPermissionsByRole(role.value);
			return {
				...role,
				permissions,
				permissionCount: permissions.length,
			};
		});

		// 分页
		const total = roles.length;
		const list = roles.slice(skip, skip + pageSize);

		return {
			list,
			total,
			page,
			pageSize,
		};
	}

	/**
	 * 获取角色详情
	 */
	async getRoleDetail(value: string) {
		const role = this.defaultRoles.find((r) => r.value === value);

		if (!role) {
			throw new NotFoundException('角色不存在');
		}

		const permissions = this.authService.getPermissionsByRole(role.value);

		return {
			...role,
			permissions,
			permissionCount: permissions.length,
		};
	}

	/**
	 * 更新角色权限
	 * 注意：由于权限是硬编码的，这里只是返回提示信息
	 * 实际项目中可以将权限配置存储到数据库
	 */
	async updateRolePermissions(value: string, dto: UpdateRolePermissionsDto) {
		const role = this.defaultRoles.find((r) => r.value === value);

		if (!role) {
			throw new NotFoundException('角色不存在');
		}

		// 系统角色不能修改权限
		if (role.isSystem) {
			throw new BadRequestException('系统角色不能修改权限');
		}

		// 验证权限格式
		const validPermissions = this.getAllValidPermissions();
		const invalidPermissions = dto.permissions.filter((p) => !validPermissions.includes(p));

		if (invalidPermissions.length > 0) {
			throw new BadRequestException(`无效的权限：${invalidPermissions.join(', ')}`);
		}

		// 注意：这里只是返回成功，实际项目中需要将权限配置保存到数据库
		// 然后修改 getPermissionsByRole 方法从数据库读取权限配置
		return {
			value: role.value,
			name: role.name,
			permissions: dto.permissions,
			message: '权限更新成功（注意：当前权限配置是硬编码的，需要重构权限系统以支持动态配置）',
		};
	}

	/**
	 * 获取所有有效的权限列表
	 */
	getAllValidPermissions(): string[] {
		const allPermissions = new Set<string>();

		// 从所有角色的权限中收集所有权限
		this.defaultRoles.forEach((role) => {
			const permissions = this.authService.getPermissionsByRole(role.value);
			permissions.forEach((p) => allPermissions.add(p));
		});

		return Array.from(allPermissions).sort();
	}

	/**
	 * 获取权限分组（用于前端展示）
	 */
	getPermissionGroups() {
		const allPermissions = this.getAllValidPermissions();
		const groups: Record<string, string[]> = {};

		allPermissions.forEach((permission) => {
			const [module] = permission.split(':');
			if (!groups[module]) {
				groups[module] = [];
			}
			groups[module].push(permission);
		});

		return Object.entries(groups).map(([module, permissions]) => ({
			module,
			permissions,
		}));
	}
}
