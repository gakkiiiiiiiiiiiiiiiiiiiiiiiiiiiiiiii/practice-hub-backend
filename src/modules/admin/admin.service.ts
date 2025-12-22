import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
  ) {}

  /**
   * 封禁/解封小程序用户
   */
  async updateUserStatus(userId: number, dto: UpdateUserStatusDto) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 这里可以添加 status 字段到 AppUser 实体，或者使用其他方式标记封禁
    // 暂时返回成功
    return { success: true };
  }
}

