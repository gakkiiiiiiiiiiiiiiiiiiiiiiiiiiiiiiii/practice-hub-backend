import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from '../../database/entities/role.entity';
import { RolePermission } from '../../database/entities/role-permission.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';
import { AuthService } from '../auth/auth.service';
import { GetRoleListDto } from './dto/get-role-list.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Injectable()
export class SystemRoleService implements OnModuleInit {
	private readonly logger = new Logger(SystemRoleService.name);
	private readonly permissionUsageCounters = new Map<string, number>();

	constructor(
		@InjectRepository(Role)
		private roleRepository: Repository<Role>,
		@InjectRepository(RolePermission)
		private rolePermissionRepository: Repository<RolePermission>,
		@InjectRepository(SysUser)
		private sysUserRepository: Repository<SysUser>,
		@Inject(forwardRef(() => AuthService))
		private readonly authService: AuthService,
	) {}

	/**
	 * 模块初始化时，确保默认角色存在
	 */
	async onModuleInit() {
		await this.ensureDefaultRoles();
	}

	/**
	 * 确保默认角色存在
	 */
	private async ensureDefaultRoles() {
		const defaultRoles = [
			{
				value: AdminRole.AGENT,
				name: '代理商',
				description: '代理商角色，可以管理激活码和查看资金记录',
				is_system: 0,
				permissions: ['dashboard:view', 'agent:view', 'agent:buy', 'agent:export', 'agent:balance:view'],
			},
			{
				value: AdminRole.CONTENT_ADMIN,
				name: '题库管理员',
				description: '题库管理员角色，可以管理课程、章节和题目',
				is_system: 0,
				permissions: [
					'dashboard:view',
					'question:view',
					'question:create',
					'question:edit',
					'question:delete',
					'question:import',
					'course:view',
					'course:create',
					'course:edit',
					'course:status',
					'course:delete',
					'chapter:view',
					'chapter:create',
					'chapter:edit',
					'chapter:delete',
				],
			},
			{
				value: AdminRole.SUPER_ADMIN,
				name: '系统管理员',
				description: '系统管理员角色，拥有所有权限',
				is_system: 1,
				permissions: [
					'dashboard:view',
					'question:view',
					'question:create',
					'question:edit',
					'question:delete',
					'question:import',
					'course:view',
					'course:create',
					'course:edit',
					'course:status',
					'course:delete',
					'chapter:view',
					'chapter:create',
					'chapter:edit',
					'chapter:delete',
					'agent:view',
					'agent:generate',
					'agent:export',
					'user:view',
					'user:manage',
					'system:account:view',
					'system:account:create',
					'system:account:edit',
					'system:account:delete',
					'system:role:view',
					'system:role:create',
					'system:role:edit',
					'system:role:delete',
					'system:config:view',
					'system:config:edit',
					'system:feedback:view',
					'system:feedback:reply',
					'system:feedback:delete',
					'system:distributor:view',
					'system:distributor:manage',
					'system:recommend:view',
					'system:recommend:edit',
				],
			},
		];

		for (const roleData of defaultRoles) {
			let role = await this.roleRepository.findOne({ where: { value: roleData.value } });

			if (!role) {
				// 创建角色
				role = this.roleRepository.create({
					value: roleData.value,
					name: roleData.name,
					description: roleData.description,
					is_system: roleData.is_system,
					status: 1,
				});
				role = await this.roleRepository.save(role);
				this.logger.log(`创建默认角色: ${roleData.name} (${roleData.value})`);

				// 创建权限
				const permissions = roleData.permissions.map((permission) =>
					this.rolePermissionRepository.create({
						role_id: role.id,
						permission,
					}),
				);
				await this.rolePermissionRepository.save(permissions);
				this.logger.log(`为角色 ${roleData.name} 创建了 ${permissions.length} 个权限`);
			} else {
				const existing = await this.rolePermissionRepository.find({ where: { role_id: role.id } });
				const existingSet = new Set(existing.map((item) => item.permission));
				const missing = roleData.permissions.filter((permission) => !existingSet.has(permission));
				if (missing.length > 0) {
					const permissions = missing.map((permission) =>
						this.rolePermissionRepository.create({
							role_id: role.id,
							permission,
							daily_limit: null,
						}),
					);
					await this.rolePermissionRepository.save(permissions);
					this.logger.log(`为角色 ${roleData.name} 补充了 ${permissions.length} 个权限`);
				}
			}
		}
	}

	/**
	 * 获取角色列表
	 */
	async getRoleList(dto: GetRoleListDto) {
		const { page = 1, pageSize = 10 } = dto;
		const skip = (page - 1) * pageSize;

		const queryBuilder = this.roleRepository.createQueryBuilder('role').leftJoinAndSelect('role.permissions', 'permissions');

		const [roles, total] = await queryBuilder.orderBy('role.create_time', 'DESC').skip(skip).take(pageSize).getManyAndCount();

		const list = roles.map((role) => ({
			id: role.id,
			value: role.value,
			name: role.name,
			description: role.description,
			isSystem: role.is_system === 1,
			status: role.status,
			permissions: role.permissions?.map((p) => p.permission) || [],
			permissionLimits: this.buildPermissionLimitMap(role.permissions),
			permissionCount: role.permissions?.length || 0,
			createdAt: role.create_time,
			updatedAt: role.update_time,
		}));

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
	async getRoleDetail(idOrValue: number | string) {
		const queryBuilder = this.roleRepository
			.createQueryBuilder('role')
			.leftJoinAndSelect('role.permissions', 'permissions');

		if (typeof idOrValue === 'number') {
			queryBuilder.where('role.id = :id', { id: idOrValue });
		} else {
			queryBuilder.where('role.value = :value', { value: idOrValue });
		}

		const role = await queryBuilder.getOne();

		if (!role) {
			throw new NotFoundException('角色不存在');
		}

		return {
			id: role.id,
			value: role.value,
			name: role.name,
			description: role.description,
			isSystem: role.is_system === 1,
			status: role.status,
			permissions: role.permissions?.map((p) => p.permission) || [],
			permissionLimits: this.buildPermissionLimitMap(role.permissions),
			permissionCount: role.permissions?.length || 0,
			createdAt: role.create_time,
			updatedAt: role.update_time,
		};
	}

	/**
	 * 创建角色
	 */
	async createRole(dto: CreateRoleDto) {
		// 检查角色标识是否已存在
		const existingRole = await this.roleRepository.findOne({ where: { value: dto.value } });

		if (existingRole) {
			throw new BadRequestException('角色标识已存在');
		}

		// 验证权限有效性
		const validPermissions = this.getAllValidPermissions();
		const invalidPermissions = dto.permissions.filter((p) => !validPermissions.includes(p));

		if (invalidPermissions.length > 0) {
			throw new BadRequestException(`无效的权限：${invalidPermissions.join(', ')}`);
		}

		// 创建角色
		const role = this.roleRepository.create({
			value: dto.value,
			name: dto.name,
			description: dto.description || '',
			is_system: 0,
			status: 1,
		});

		const savedRole = await this.roleRepository.save(role);

		// 创建权限关联
		const permissionLimits = this.normalizePermissionLimits(dto.permissionLimits, dto.permissions);
		if (dto.permissions.length > 0) {
			const permissions = dto.permissions.map((permission) =>
				this.rolePermissionRepository.create({
					role_id: savedRole.id,
					permission,
					daily_limit: permissionLimits[permission] ?? null,
				}),
			);
			await this.rolePermissionRepository.save(permissions);
		}

		return {
			id: savedRole.id,
			value: savedRole.value,
			name: savedRole.name,
			description: savedRole.description,
			permissions: dto.permissions,
			permissionLimits,
			permissionCount: dto.permissions.length,
			createdAt: savedRole.create_time,
		};
	}

	/**
	 * 更新角色权限
	 */
	async updateRolePermissions(idOrValue: number | string, dto: UpdateRolePermissionsDto) {
		const queryBuilder = this.roleRepository
			.createQueryBuilder('role')
			.leftJoinAndSelect('role.permissions', 'permissions');

		if (typeof idOrValue === 'number') {
			queryBuilder.where('role.id = :id', { id: idOrValue });
		} else {
			queryBuilder.where('role.value = :value', { value: idOrValue });
		}

		const role = await queryBuilder.getOne();

		if (!role) {
			throw new NotFoundException('角色不存在');
		}

		// 系统角色不能修改权限
		if (role.is_system === 1) {
			throw new BadRequestException('系统角色不能修改权限');
		}

		// 验证权限有效性
		const validPermissions = this.getAllValidPermissions();
		const invalidPermissions = dto.permissions.filter((p) => !validPermissions.includes(p));

		if (invalidPermissions.length > 0) {
			throw new BadRequestException(`无效的权限：${invalidPermissions.join(', ')}`);
		}

		// 删除旧权限
		if (role.permissions && role.permissions.length > 0) {
			await this.rolePermissionRepository.delete({ role_id: role.id });
		}

		// 创建新权限关联
		const permissionLimits = this.normalizePermissionLimits(dto.permissionLimits, dto.permissions);
		if (dto.permissions.length > 0) {
			const permissions = dto.permissions.map((permission) =>
				this.rolePermissionRepository.create({
					role_id: role.id,
					permission,
					daily_limit: permissionLimits[permission] ?? null,
				}),
			);
			await this.rolePermissionRepository.save(permissions);
		}

		return {
			id: role.id,
			value: role.value,
			name: role.name,
			permissions: dto.permissions,
			permissionLimits,
			permissionCount: dto.permissions.length,
			updatedAt: new Date(),
		};
	}

	/**
	 * 删除角色
	 */
	async deleteRole(id: number) {
		const role = await this.roleRepository.findOne({ where: { id } });

		if (!role) {
			throw new NotFoundException('角色不存在');
		}

		// 系统角色不能删除
		if (role.is_system === 1) {
			throw new BadRequestException('系统角色不能删除');
		}

		// 检查是否有用户使用此角色
		const userCount = await this.sysUserRepository.count({ where: { role_id: id } });

		if (userCount > 0) {
			throw new BadRequestException(`该角色正在被 ${userCount} 个用户使用，无法删除`);
		}

		// 删除权限关联
		await this.rolePermissionRepository.delete({ role_id: id });

		// 删除角色
		await this.roleRepository.remove(role);

		return { success: true };
	}

	/**
	 * 获取所有有效的权限列表
	 */
	getAllValidPermissions(): string[] {
		const allPermissions = new Set<string>();

		// 从硬编码的权限中收集所有权限（用于验证）
		const hardcodedRoles = [AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN, AdminRole.AGENT];
		hardcodedRoles.forEach((roleValue) => {
			// 使用同步方式获取硬编码权限（避免循环依赖）
			const permissionMap: Record<string, string[]> = {
				super_admin: [
					'dashboard:view',
					'question:view',
					'question:create',
					'question:edit',
					'question:delete',
					'question:import',
					'course:view',
					'course:create',
					'course:edit',
					'course:status',
					'course:delete',
					'chapter:view',
					'chapter:create',
					'chapter:edit',
					'chapter:delete',
					'agent:view',
					'agent:generate',
					'agent:export',
					'user:view',
					'user:manage',
					'system:account:view',
					'system:account:create',
					'system:account:edit',
					'system:account:delete',
					'system:role:view',
					'system:role:create',
					'system:role:edit',
					'system:role:delete',
					'system:config:view',
					'system:config:edit',
					'system:feedback:view',
					'system:feedback:reply',
					'system:feedback:delete',
					'system:distributor:view',
					'system:distributor:manage',
					'system:recommend:view',
					'system:recommend:edit',
				],
				content_admin: [
					'dashboard:view',
					'question:view',
					'question:create',
					'question:edit',
					'question:delete',
					'question:import',
					'course:view',
					'course:create',
					'course:edit',
					'course:status',
					'course:delete',
					'chapter:view',
					'chapter:create',
					'chapter:edit',
					'chapter:delete',
				],
				agent: [
					'dashboard:view',
					'agent:view',
					'agent:buy',
					'agent:export',
					'agent:balance:view',
				],
			};
			const permissions = permissionMap[roleValue] || [];
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
		const permissionOrder: Record<string, string[]> = {
			course: ['course:view', 'course:create', 'course:edit', 'course:status', 'course:delete'],
		};

		allPermissions.forEach((permission) => {
			const [module] = permission.split(':');
			if (!groups[module]) {
				groups[module] = [];
			}
			groups[module].push(permission);
		});
		permissionOrder.course.forEach((permission) => {
			if (!groups.course) {
				groups.course = [];
			}
			if (!groups.course.includes(permission)) {
				groups.course.push(permission);
			}
		});

		return Object.entries(groups).map(([module, permissions]) => ({
			module,
			permissions: permissionOrder[module]
				? permissionOrder[module]
						.filter((permission) => permissions.includes(permission))
						.concat(permissions.filter((permission) => !permissionOrder[module].includes(permission)))
				: permissions,
		}));
	}

	/**
	 * 根据角色ID或值获取权限列表（用于权限验证）
	 */
	async getPermissionsByRoleIdOrValue(idOrValue: number | string): Promise<string[]> {
		const queryBuilder = this.roleRepository
			.createQueryBuilder('role')
			.leftJoinAndSelect('role.permissions', 'permissions');

		if (typeof idOrValue === 'number') {
			queryBuilder.where('role.id = :id', { id: idOrValue });
		} else {
			queryBuilder.where('role.value = :value', { value: idOrValue });
		}

		const role = await queryBuilder.getOne();

		if (!role || !role.permissions) {
			return [];
		}

		return role.permissions.map((p) => p.permission);
	}

	async assertPermissionUsage(role: string | number, permission: string, actorId?: number) {
		const queryBuilder = this.roleRepository
			.createQueryBuilder('role')
			.leftJoinAndSelect('role.permissions', 'permissions');

		if (typeof role === 'number') {
			queryBuilder.where('role.id = :id', { id: role });
		} else {
			queryBuilder.where('role.value = :value', { value: role });
		}

		const roleEntity = await queryBuilder.getOne();
		const permissionEntity = roleEntity?.permissions?.find((item) => item.permission === permission);
		if (!permissionEntity) {
			throw new ForbiddenException('权限不足');
		}

		const limit = permissionEntity.daily_limit;
		if (limit == null || limit <= 0) {
			return;
		}

		const today = new Date().toISOString().slice(0, 10);
		const key = `${today}:${actorId || 'anonymous'}:${roleEntity?.id || role}:${permission}`;
		const used = this.permissionUsageCounters.get(key) || 0;
		if (used >= limit) {
			throw new ForbiddenException(`权限 ${permission} 今日调用次数已达上限`);
		}
		this.permissionUsageCounters.set(key, used + 1);
	}

	private buildPermissionLimitMap(permissions?: RolePermission[]) {
		const map: Record<string, number | null> = {};
		(permissions || []).forEach((item) => {
			map[item.permission] = item.daily_limit ?? null;
		});
		return map;
	}

	private normalizePermissionLimits(input: Record<string, unknown> | undefined, permissions: string[]) {
		const allowed = new Set(permissions);
		const result: Record<string, number | null> = {};
		Object.entries(input || {}).forEach(([permission, value]) => {
			if (!allowed.has(permission)) return;
			if (value === null || value === undefined || value === '') {
				result[permission] = null;
				return;
			}
			const limit = Number(value);
			if (!Number.isInteger(limit) || limit < 1) {
				throw new BadRequestException(`${permission} 的每日调用上限必须为正整数或留空`);
			}
			result[permission] = limit;
		});
		return result;
	}
}
