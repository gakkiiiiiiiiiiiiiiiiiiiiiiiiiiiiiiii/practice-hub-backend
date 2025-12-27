import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { AppUser } from '../../database/entities/app-user.entity';
import { SysUser } from '../../database/entities/sys-user.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
	constructor(
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
		@InjectRepository(SysUser)
		private sysUserRepository: Repository<SysUser>,
		private jwtService: JwtService,
		private configService: ConfigService
	) {}

	/**
	 * 小程序端 - 微信一键登录
	 */
	async appLogin(code: string) {
		if (!code) {
			throw new BadRequestException('code 不能为空');
		}

		// 调用微信接口换取 openid
		const appid = this.configService.get('WECHAT_APPID');
		const secret = this.configService.get('WECHAT_SECRET');

		// 检查配置
		if (!appid || !secret) {
			console.error('微信配置缺失:', {
				hasAppid: !!appid,
				hasSecret: !!secret,
				appidLength: appid?.length || 0,
				secretLength: secret?.length || 0,
			});
			throw new UnauthorizedException('微信登录配置错误，请联系管理员');
		}

		try {
			const response = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
				params: {
					appid,
					secret,
					js_code: code,
					grant_type: 'authorization_code',
				},
			});

			const { openid, session_key, errcode, errmsg } = response.data;

			// 处理微信 API 返回的错误
			if (errcode) {
				console.error('微信 API 错误:', { errcode, errmsg, code: code.substring(0, 10) + '...' });
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

			if (!user) {
				user = this.appUserRepository.create({
					openid,
					nickname: '新用户',
				});
				await this.appUserRepository.save(user);
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
}
