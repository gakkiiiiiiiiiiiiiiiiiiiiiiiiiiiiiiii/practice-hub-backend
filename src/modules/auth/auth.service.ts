import { Injectable, UnauthorizedException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import * as https from 'https';
import { randomUUID } from 'crypto';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { SysUser } from '../../database/entities/sys-user.entity';
import { ConfigService } from '@nestjs/config';
import { DistributorService } from '../distributor/distributor.service';
import { SystemRoleService } from '../system-role/system-role.service';
import { AppUserSessionService } from './app-user-session.service';
import { AppRegisterDto } from './dto/app-register.dto';
import { AppPasswordLoginDto } from './dto/app-password-login.dto';
import { ReferralCouponService } from '../marketing/referral-coupon.service';

@Injectable()
export class AuthService {
	private wechatAccessTokenCache: { token: string; expiresAt: number } | null = null;

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
		private appUserSessionService: AppUserSessionService,
		private referralCouponService: ReferralCouponService,
	) {}

	/**
	 * 小程序端 - 微信一键登录
	 */
	async appLogin(code: string, distributorCode?: string, profile?: { nickname?: string; avatar?: string }, referralUserId?: number) {
		if (!code) {
			throw new BadRequestException('code 不能为空');
		}

		// 调用微信接口换取 openid
		const appid = this.configService.get('WECHAT_APPID') || this.configService.get('AppID');
		const secret =
			this.configService.get('WECHAT_SECRET') || this.configService.get('WECHAT_APPSECRET') || this.configService.get('AppSecret');

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
						nickname: this.normalizeOptionalString(profile?.nickname) || '新用户',
						avatar: this.normalizeOptionalString(profile?.avatar) || null,
					});
				}
				if (this.isAppAdminOpenid(openid)) {
					user.role = AppUserRole.ADMIN;
				}
				const nickname = this.normalizeOptionalString(profile?.nickname);
				const avatar = this.normalizeOptionalString(profile?.avatar);
				if (nickname) {
					user.nickname = nickname;
				}
				if (avatar) {
					user.avatar = avatar;
				}
				user.session_key = session_key || user.session_key;
				await this.appUserRepository.save(user);

			const normalizedDistributorCode = this.normalizeDistributorCode(distributorCode);

			// 如果是新用户且提供了分销商编号，绑定分销关系
			if (isNewUser && normalizedDistributorCode) {
				try {
					await this.distributorService.bindDistributionRelation(user.id, normalizedDistributorCode);
				} catch (error) {
					// 绑定失败不影响登录，只记录日志
					console.warn('绑定分销关系失败:', error.message);
				}
			}

			if (referralUserId) {
				try {
					const referral = await this.referralCouponService.bindReferralOnAuth(user.id, referralUserId);
					if (referral) {
						console.log(`拉新绑定成功: inviter=${referralUserId}, invitee=${user.id}`);
					}
				} catch (error) {
					console.warn('绑定拉新关系失败:', error.message);
				}
			}

			// 生成 Token
			const token = this.issueAppToken(user);

			return {
				token,
				user: this.buildAppUserResponse(user),
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
	 * 小程序端 - 手机号快捷登录
	 */
	async appPhoneLogin(
		loginCode: string,
		phoneCode: string,
		distributorCode?: string,
		profile?: { nickname?: string; avatar?: string },
		referralUserId?: number,
	) {
		if (!loginCode) {
			throw new BadRequestException('loginCode 不能为空');
		}
		if (!phoneCode) {
			throw new BadRequestException('phoneCode 不能为空');
		}

		try {
			const { openid, session_key } = await this.getWechatSessionByCode(loginCode);
			const phone = await this.getPhoneNumberByCode(phoneCode);

			let user = await this.appUserRepository.findOne({ where: { openid } });
			if (!user && phone) {
				user = await this.appUserRepository.findOne({ where: { phone } });
			}
			const isNewUser = !user;

			if (!user) {
				user = this.appUserRepository.create({
					openid,
					phone,
					nickname: this.normalizeOptionalString(profile?.nickname) || '微信用户',
					avatar: this.normalizeOptionalString(profile?.avatar) || null,
				});
			}

			user.openid = user.openid || openid;
			user.phone = phone || user.phone;
			user.session_key = session_key || user.session_key;

			if (this.isAppAdminOpenid(openid)) {
				user.role = AppUserRole.ADMIN;
			}

			const nickname = this.normalizeOptionalString(profile?.nickname);
			const avatar = this.normalizeOptionalString(profile?.avatar);
			if (nickname) {
				user.nickname = nickname;
			}
			if (avatar) {
				user.avatar = avatar;
			}
			await this.appUserRepository.save(user);

			const normalizedDistributorCode = this.normalizeDistributorCode(distributorCode);
			if (isNewUser && normalizedDistributorCode) {
				try {
					await this.distributorService.bindDistributionRelation(user.id, normalizedDistributorCode);
				} catch (error) {
					console.warn('绑定分销关系失败:', error.message);
				}
			}

			if (referralUserId) {
				try {
					const referral = await this.referralCouponService.bindReferralOnAuth(user.id, referralUserId);
					if (referral) {
						console.log(`拉新绑定成功: inviter=${referralUserId}, invitee=${user.id}`);
					}
				} catch (error) {
					console.warn('绑定拉新关系失败:', error.message);
				}
			}

			const token = this.issueAppToken(user);

			return {
				token,
				user: this.buildAppUserResponse(user),
			};
		} catch (error) {
			if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
				throw error;
			}
			console.error('手机号快捷登录异常:', {
				message: error.message,
				code: error.code,
				response: error.response?.data,
				status: error.response?.status,
			});
			throw new UnauthorizedException(error.message || '手机号快捷登录失败，请重试');
		}
	}

	private getWechatConfig() {
		const appid = this.configService.get('WECHAT_APPID') || this.configService.get('AppID');
		const secret =
			this.configService.get('WECHAT_SECRET') || this.configService.get('WECHAT_APPSECRET') || this.configService.get('AppSecret');
		if (!appid || !secret) {
			console.error('微信配置缺失:', {
				hasAppid: !!appid,
				hasSecret: !!secret,
			});
			throw new UnauthorizedException('微信登录配置错误，请联系管理员');
		}
		return { appid, secret };
	}

	private async getWechatSessionByCode(code: string) {
		const { appid, secret } = this.getWechatConfig();
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
		if (errcode) {
			throw new UnauthorizedException(this.getWechatLoginErrorMessage(errcode, errmsg));
		}
		if (!openid) {
			throw new UnauthorizedException('微信登录失败：未获取到用户标识');
		}
		return { openid, session_key };
	}

	private getWechatLoginErrorMessage(errcode: number, errmsg?: string) {
		switch (errcode) {
			case 40029:
				return '登录凭证已过期，请重新登录';
			case 45011:
				return '登录请求过于频繁，请稍后再试';
			case 40163:
				return '登录凭证已被使用，请重新登录';
			default:
				return errmsg || `微信登录失败 (${errcode})`;
		}
	}

	private async getWechatAccessToken() {
		const now = Date.now();
		if (this.wechatAccessTokenCache && this.wechatAccessTokenCache.expiresAt > now + 60_000) {
			return this.wechatAccessTokenCache.token;
		}
		const { appid, secret } = this.getWechatConfig();
		const httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		});
		const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
			params: {
				grant_type: 'client_credential',
				appid,
				secret,
			},
			httpsAgent,
		});
		const { access_token, expires_in, errcode, errmsg } = response.data;
		if (errcode || !access_token) {
			throw new UnauthorizedException(errmsg || `获取微信 access_token 失败 (${errcode || 'unknown'})`);
		}
		this.wechatAccessTokenCache = {
			token: access_token,
			expiresAt: now + Math.max(300, Number(expires_in) || 7200) * 1000,
		};
		return access_token;
	}

	private async getPhoneNumberByCode(phoneCode: string) {
		const accessToken = await this.getWechatAccessToken();
		const httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		});
		const response = await axios.post(
			`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`,
			{ code: phoneCode },
			{ httpsAgent },
		);
		const { errcode, errmsg, phone_info } = response.data;
		if (errcode) {
			throw new UnauthorizedException(errmsg || `获取手机号失败 (${errcode})`);
		}
		const phone = phone_info?.phoneNumber || phone_info?.purePhoneNumber;
		if (!phone) {
			throw new UnauthorizedException('获取手机号失败：微信未返回手机号');
		}
		return phone;
	}

	private normalizeDistributorCode(distributorCode?: string): string {
		const raw = String(distributorCode || '').trim();
		if (!raw) return '';
		const params = new URLSearchParams(raw);
		return params.get('inviterid') || params.get('distributor_code') || raw;
	}

	private normalizeOptionalString(value?: string): string {
		return String(value || '').trim();
	}

	parseReferralUserIdPublic(value?: string | number | null) {
		return this.parseReferralUserId(value);
	}

	private parseReferralUserId(value?: string | number | null) {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return null;
		}
		return parsed;
	}

	/**
	 * 小程序端 - 账号注册（注册后自动登录）
	 */
	async appRegister(dto: AppRegisterDto) {
		const username = dto.username.trim().toLowerCase();
		const existing = await this.appUserRepository.findOne({ where: { username } });
		if (existing) {
			throw new BadRequestException('用户名已被占用');
		}

		const passwordHash = await bcrypt.hash(dto.password, 10);
		const user = this.appUserRepository.create({
			openid: `acct_${randomUUID()}`,
			username,
			password_hash: passwordHash,
			nickname: this.normalizeOptionalString(dto.nickname) || username,
			avatar: null,
			role: AppUserRole.USER,
		});
		await this.appUserRepository.save(user);

		const referralUserId = this.parseReferralUserId(dto.referral_user_id);
		if (referralUserId) {
			try {
				const referral = await this.referralCouponService.bindReferralOnAuth(user.id, referralUserId);
				if (referral) {
					console.log(`拉新绑定成功: inviter=${referralUserId}, invitee=${user.id}`);
				}
			} catch (error) {
				console.warn('绑定拉新关系失败:', error.message);
			}
		}

		const sessionId = await this.appUserSessionService.createPasswordSession(
			user.id,
			dto.device_id,
			dto.device_name,
			dto.platform,
		);

		const token = this.issueAppToken(user, {
			authMethod: 'password',
			sessionId,
		});

		return {
			token,
			user: this.buildAppUserResponse(user),
		};
	}

	/**
	 * 小程序端 - 账号密码登录（最多3台设备同时在线）
	 */
	async appPasswordLogin(dto: AppPasswordLoginDto) {
		const username = dto.username.trim().toLowerCase();
		const user = await this.appUserRepository.findOne({ where: { username } });
		if (!user || !user.password_hash) {
			throw new UnauthorizedException('用户名或密码错误');
		}

		const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);
		if (!isPasswordValid) {
			throw new UnauthorizedException('用户名或密码错误');
		}

		const sessionId = await this.appUserSessionService.createPasswordSession(
			user.id,
			dto.device_id,
			dto.device_name,
			dto.platform,
		);

		const token = this.issueAppToken(user, {
			authMethod: 'password',
			sessionId,
		});

		return {
			token,
			user: this.buildAppUserResponse(user),
		};
	}

	/**
	 * 小程序端 - 账号登录退出（仅撤销当前设备会话）
	 */
	async appLogout(userId: number, sessionId?: string) {
		if (sessionId) {
			await this.appUserSessionService.revokeSession(sessionId, userId);
		}
		return { success: true };
	}

	private issueAppToken(
		user: AppUser,
		options?: {
			authMethod?: 'password' | 'wechat';
			sessionId?: string;
		},
	) {
		const payload: Record<string, unknown> = {
			userId: user.id,
			openid: user.openid,
			role: user.role || AppUserRole.USER,
			type: 'app',
		};
		if (options?.authMethod === 'password' && options.sessionId) {
			payload.authMethod = 'password';
			payload.sessionId = options.sessionId;
		}
		return this.jwtService.sign(payload);
	}

	private buildAppUserResponse(user: AppUser) {
		return {
			id: user.id,
			openid: user.openid,
			username: user.username || null,
			nickname: user.nickname,
			avatar: user.avatar,
			phone: user.phone,
			package_expire_time: user.package_expire_time,
			role: user.role || AppUserRole.USER,
			is_admin: user.role === AppUserRole.ADMIN,
			is_bank_admin: user.role === AppUserRole.BANK_ADMIN,
			has_password: !!user.password_hash,
		};
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

			return permissionMap[String(role)] || [];
		}

		private isAppAdminOpenid(openid: string): boolean {
			const raw = this.configService.get<string>('APP_ADMIN_OPENIDS') || this.configService.get<string>('WECHAT_APP_ADMIN_OPENIDS') || '';
			return raw
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean)
				.includes(openid);
		}
	}
