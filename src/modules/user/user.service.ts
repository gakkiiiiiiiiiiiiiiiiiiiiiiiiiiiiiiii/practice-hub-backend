import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { CoinService } from '../order/coin.service';
import { UserTitleService } from './user-title.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
    private coinService: CoinService,
    private readonly userTitleService: UserTitleService,
  ) {}

  /**
   * 获取用户信息
   */
  async getUserInfo(userId: number) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const hasPackage = user.package_expire_time && user.package_expire_time > new Date();
    let coinBalance = Math.max(0, Math.floor(Number(user.coin_balance || 0)));
    if (user.session_key) {
      try {
        coinBalance = await this.coinService.queryWechatBalance(user);
      } catch {
        // 查询失败时使用本地缓存余额
      }
    }

    const userTitle = await this.userTitleService.resolveUserTitle(userId);
    const studyDays = userTitle?.studyDays ?? (await this.userTitleService.countUserStudyDays(userId));

    return {
      id: user.id,
      openid: user.openid,
      username: user.username || null,
      nickname: user.nickname,
      avatar: user.avatar,
      phone: user.phone,
      role: user.role || AppUserRole.USER,
      is_admin: user.role === AppUserRole.ADMIN,
      is_bank_admin: user.role === AppUserRole.BANK_ADMIN,
      has_password: !!user.password_hash,
      hasPackage,
      package_expire_time: user.package_expire_time,
      coin_balance: coinBalance,
      points_balance: Math.max(0, Number(user.points_balance || 0)),
      study_days: studyDays,
      user_title: userTitle,
    };
  }

  /**
   * 更新用户信息
   */
  async updateProfile(userId: number, dto: UpdateUserProfileDto) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (dto.nickname) {
      user.nickname = dto.nickname;
    }
    if (dto.avatar) {
      user.avatar = dto.avatar;
    }

    await this.appUserRepository.save(user);

    return this.getUserInfo(userId);
  }

  /**
   * 绑定手机号
   */
  async bindPhone(userId: number, dto: BindPhoneDto) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    user.phone = dto.phone;
    await this.appUserRepository.save(user);

    return this.getUserInfo(userId);
  }
}
