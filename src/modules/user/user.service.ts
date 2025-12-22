import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
  ) {}

  /**
   * 获取用户信息
   */
  async getUserInfo(userId: number) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const isVip = user.vip_expire_time && user.vip_expire_time > new Date();

    return {
      id: user.id,
      openid: user.openid,
      nickname: user.nickname,
      avatar: user.avatar,
      phone: user.phone,
      isVip,
      vip_expire_time: user.vip_expire_time,
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

