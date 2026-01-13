import { Injectable, UnauthorizedException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import * as https from 'https';
import { AppUser } from '../../database/entities/app-user.entity';
import { SysUser } from '../../database/entities/sys-user.entity';
import { ConfigService } from '@nestjs/config';
import { DistributorService } from '../distributor/distributor.service';
import { SystemRoleService } from '../system-role/system-role.service';

@Injectable()
export class AuthService {
	constructor(
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
		@InjectRepository(SysUser)
		private sysUserRepository: Repository<SysUser>,
		private jwtService: JwtService,
		private configService: ConfigService,
		private distributorService: DistributorService,
		@Inject(forwardRef(() => SystemRoleService))
		private systemRoleService: SystemRoleService,
	) {}

	/**
	 * 小程序端 - 微信一键登录
	 */
	async appLogin(code: string, distributorCode?: string) {
		if (!code) {
			throw new BadRequestException('code 不能为空');
		}

		// 调用微信接口换取 openid
		const appid = this.configService.get('WECHAT_APPID');
		const secret = this.configService.get('WECHAT_SECRET');

		// 检查配置
		if (!appid || !secret) {
			// 安全：不在日志中打印敏感信息（如 secret）
			console.error('微信配置缺失:', {
				hasAppid: !!appid,
				hasSecret: !!secret,
			});
			throw new UnauthorizedException('微信登录配置错误，请联系管理员');
		}

		try {
			// 配置 https Agent 以跳过 SSL 证书验证（微信云托管环境需要）
			const httpsAgent = new https.Agent({
				rejectUnauthorized: false,
			});

			const response = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
				params: {
					appid,
					secret,
					js_code: code,
					grant_type: 'authorization_code',
				},
				httpsAgent,
			});

			const { openid, session_key, errcode, errmsg } = response.data;

			// 处理微信 API 返回的错误
			if (errcode) {
				// 安全：不在日志中打印完整的 code（可能包含敏感信息）
				console.error('微信 API 错误:', { errcode, errmsg });
				let errorMessage = '微信登录失败';

				// 根据错误码返回更具体的错误信息
				switch (errcode) {
					case 40029:
						errorMessage = '登录凭证已过期，请重新登录';
						break;
					case 45011:
						errorMessage = '登录请求过于频繁，请稍后再试';
						break;
					case 40163:
						errorMessage = '登录凭证已被使用，请重新登录';
						break;
					default:
						errorMessage = errmsg || `微信登录失败 (${errcode})`;
				}

				throw new UnauthorizedException(errorMessage);
			}

			if (!openid) {
				console.error('微信 API 返回数据异常:', response.data);
				throw new UnauthorizedException('微信登录失败：未获取到用户标识');
			}

			// 查找或创建用户
			let user = await this.appUserRepository.findOne({ where: { openid } });
			const isNewUser = !user;

			if (!user) {
				user = this.appUserRepository.create({
					openid,
					nickname: '新用户',
				});
				await this.appUserRepository.save(user);
			}

			// 如果是新用户且提供了分销商编号，绑定分销关系
			if (isNewUser && distributorCode) {
				try {
					await this.distributorService.bindDistributionRelation(user.id, distributorCode);
				} catch (error) {
					// 绑定失败不影响登录，只记录日志
					console.warn('绑定分销关系失败:', error.message);
				}
			}

			// 生成 Token
			const token = this.jwtService.sign({
				userId: user.id,
				openid: user.openid,
				type: 'app',
			});

			return {
				token,
				user: {
					id: user.id,
					openid: user.openid,
					nickname: user.nickname,
					avatar: user.avatar,
					vip_expire_time: user.vip_expire_time,
				},
			};
		} catch (error) {
			// 如果是已定义的异常，直接抛出
			if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
				throw error;
			}

			// 其他错误（网络错误、数据库错误等）
			console.error('微信登录异常:', {
				message: error.message,
				code: error.code,
				response: error.response?.data,
				status: error.response?.status,
				stack: error.stack,
			});

			// 如果是 axios 错误，提供更详细的错误信息
			if (error.response) {
				const status = error.response.status;
				const data = error.response.data;
				throw new UnauthorizedException(`微信登录失败: ${data?.errmsg || data?.message || `HTTP ${status}`}`);
			}

			throw new UnauthorizedException(error.message || '微信登录失败，请重试');
		}
	}

	/**
	 * 管理后台 - 账号密码登录
	 */
	async adminLogin(username: string, password: string) {
		const admin = await this.sysUserRepository.findOne({ where: { username } });

		if (!admin) {
			throw new UnauthorizedException('用户名或密码错误');
		}

		if (admin.status === 0) {
			throw new UnauthorizedException('账号已被禁用');
		}

		const isPasswordValid = await bcrypt.compare(password, admin.password);
		if (!isPasswordValid) {
			throw new UnauthorizedException('用户名或密码错误');
		}

		// 生成 Token
		const token = this.jwtService.sign({
			adminId: admin.id,
			role: admin.role,
			type: 'admin',
		});

		return {
			token,
			admin: {
				id: admin.id,
				username: admin.username,
				role: admin.role,
				balance: admin.balance,
			},
		};
	}

	/**
	 * 验证 Token
	 */
	async validateToken(token: string) {
		try {
			const payload = this.jwtService.verify(token);
			return payload;
		} catch (error) {
			throw new UnauthorizedException('Token 无效或已过期');
		}
	}

	/**
	 * 根据角色获取权限列表
	 * 优先从数据库读取，如果数据库中没有则使用硬编码的权限（向后兼容）
	 */
	async getPermissionsByRole(role: string | number): Promise<string[]> {
		try {
			// 尝试从数据库读取权限
			const permissions = await this.systemRoleService.getPermissionsByRoleIdOrValue(role);
			if (permissions && permissions.length > 0) {
				return permissions;
			}
		} catch (error) {
			// 如果数据库中没有该角色，继续使用硬编码权限
		}

		// 回退到硬编码权限（向后兼容）
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

		return permissionMap[String(role)] || [];
	}
}
