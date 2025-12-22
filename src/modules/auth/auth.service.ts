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
    private configService: ConfigService,
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

      if (errcode || !openid) {
        throw new UnauthorizedException(errmsg || '微信登录失败');
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
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('微信登录失败，请重试');
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

