import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SysUser } from '../../database/entities/sys-user.entity';
import { GetAccountListDto } from './dto/get-account-list.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class SystemAccountService {
	constructor(
		@InjectRepository(SysUser)
		private sysUserRepository: Repository<SysUser>,
	) {}

	/**
	 * 获取账号列表
	 */
	async getAccountList(dto: GetAccountListDto) {
		const { page = 1, pageSize = 10, keyword, status, role } = dto;
		const skip = (page - 1) * pageSize;

		const queryBuilder = this.sysUserRepository.createQueryBuilder('user');

		// 搜索条件
		if (keyword) {
			queryBuilder.where('user.username LIKE :keyword', { keyword: `%${keyword}%` });
		}

		// 状态筛选
		if (status !== undefined) {
			if (keyword) {
				queryBuilder.andWhere('user.status = :status', { status });
			} else {
				queryBuilder.where('user.status = :status', { status });
			}
		}

		// 角色筛选
		if (role) {
			const whereKey = keyword || status !== undefined ? 'andWhere' : 'where';
			queryBuilder[whereKey]('user.role = :role', { role });
		}

		// 总数
		const total = await queryBuilder.getCount();

		// 分页查询
		const users = await queryBuilder
			.orderBy('user.create_time', 'DESC')
			.skip(skip)
			.take(pageSize)
			.getMany();

		// 格式化返回数据（不返回密码）
		const list = users.map((user) => ({
			id: user.id,
			username: user.username,
			role: user.role,
			balance: Number(user.balance),
			status: user.status,
			createdAt: user.create_time,
			updatedAt: user.update_time,
		}));

		return {
			list,
			total,
			page,
			pageSize,
		};
	}

	/**
	 * 获取账号详情
	 */
	async getAccountDetail(id: number) {
		const user = await this.sysUserRepository.findOne({ where: { id } });

		if (!user) {
			throw new NotFoundException('账号不存在');
		}

		// 不返回密码
		return {
			id: user.id,
			username: user.username,
			role: user.role,
			balance: Number(user.balance),
			status: user.status,
			createdAt: user.create_time,
			updatedAt: user.update_time,
		};
	}

	/**
	 * 创建账号
	 */
	async createAccount(dto: CreateAccountDto) {
		// 检查用户名是否已存在
		const existingUser = await this.sysUserRepository.findOne({
			where: { username: dto.username },
		});

		if (existingUser) {
			throw new BadRequestException('用户名已存在');
		}

		// 加密密码
		const hashedPassword = await bcrypt.hash(dto.password, 10);

		// 创建账号
		const user = this.sysUserRepository.create({
			username: dto.username,
			password: hashedPassword,
			role: dto.role,
			status: dto.status !== undefined ? dto.status : 1, // 默认启用
			balance: 0,
		});

		await this.sysUserRepository.save(user);

		// 返回创建结果（不返回密码）
		return {
			id: user.id,
			username: user.username,
			role: user.role,
			status: user.status,
			createdAt: user.create_time,
		};
	}

	/**
	 * 更新账号
	 */
	async updateAccount(id: number, dto: UpdateAccountDto) {
		const user = await this.sysUserRepository.findOne({ where: { id } });

		if (!user) {
			throw new NotFoundException('账号不存在');
		}

		// 更新密码（如果提供）
		if (dto.password) {
			user.password = await bcrypt.hash(dto.password, 10);
		}

		// 更新角色（如果提供）
		if (dto.role !== undefined) {
			user.role = dto.role;
		}

		// 更新状态（如果提供）
		if (dto.status !== undefined) {
			user.status = dto.status;
		}

		await this.sysUserRepository.save(user);

		// 返回更新结果（不返回密码）
		return {
			id: user.id,
			username: user.username,
			role: user.role,
			status: user.status,
			updatedAt: user.update_time,
		};
	}

	/**
	 * 删除账号
	 */
	async deleteAccount(id: number) {
		const user = await this.sysUserRepository.findOne({ where: { id } });

		if (!user) {
			throw new NotFoundException('账号不存在');
		}

		// 不能删除自己（需要在控制器中检查当前登录用户）
		await this.sysUserRepository.remove(user);

		return { success: true };
	}
}
