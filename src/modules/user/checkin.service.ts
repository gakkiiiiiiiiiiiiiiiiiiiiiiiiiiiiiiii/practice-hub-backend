import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { UserCheckin } from '../../database/entities/user-checkin.entity';
import { SystemConfig } from '../../database/entities/system-config.entity';

@Injectable()
export class CheckinService {
  constructor(
    @InjectRepository(UserCheckin)
    private checkinRepository: Repository<UserCheckin>,
    @InjectRepository(SystemConfig)
    private systemConfigRepository: Repository<SystemConfig>,
  ) {}

  /**
   * 获取打卡所需时间（分钟）
   */
  async getCheckinMinutes(): Promise<number> {
    const config = await this.systemConfigRepository.findOne({
      where: { configKey: 'checkin_minutes' },
    });

    if (config && config.configValue) {
      try {
        const minutes = parseInt(config.configValue, 10);
        if (!isNaN(minutes) && minutes > 0) {
          return minutes;
        }
      } catch (e) {
        console.error('解析打卡时间配置失败:', e);
      }
    }

    // 默认30分钟
    return 30;
  }

  /**
   * 检查是否可以打卡（学习时长是否达到要求）
   */
  async canCheckin(userId: number, studyDuration: number): Promise<{ canCheckin: boolean; requiredMinutes: number; currentMinutes: number }> {
    const requiredMinutes = await this.getCheckinMinutes();
    const currentMinutes = Math.floor(studyDuration / 60);

    return {
      canCheckin: currentMinutes >= requiredMinutes,
      requiredMinutes,
      currentMinutes,
    };
  }

  /**
   * 打卡
   */
  async checkin(userId: number, studyDuration: number, questionCount: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 检查今天是否已经打卡
    const existingCheckin = await this.checkinRepository.findOne({
      where: {
        userId,
        checkinDate: today,
      },
    });

    if (existingCheckin) {
      throw new BadRequestException('今天已经打卡过了');
    }

    // 检查是否可以打卡
    const { canCheckin, requiredMinutes, currentMinutes } = await this.canCheckin(userId, studyDuration);
    if (!canCheckin) {
      throw new BadRequestException(`学习时长不足，需要${requiredMinutes}分钟，当前${currentMinutes}分钟`);
    }

    // 创建打卡记录
    const checkin = this.checkinRepository.create({
      userId,
      checkinDate: today,
      studyDuration,
      questionCount,
    });

    await this.checkinRepository.save(checkin);

    return {
      success: true,
      message: '打卡成功',
      checkin: {
        id: checkin.id,
        checkinDate: checkin.checkinDate,
        studyDuration: checkin.studyDuration,
        questionCount: checkin.questionCount,
        createTime: checkin.createTime,
      },
    };
  }

  /**
   * 获取用户打卡记录
   */
  async getUserCheckins(userId: number, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;

    const [checkins, total] = await this.checkinRepository.findAndCount({
      where: { userId },
      order: { checkinDate: 'DESC' },
      skip,
      take: pageSize,
    });

    return {
      list: checkins.map((checkin) => ({
        id: checkin.id,
        checkinDate: checkin.checkinDate,
        studyDuration: checkin.studyDuration,
        questionCount: checkin.questionCount,
        createTime: checkin.createTime,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取用户今日打卡状态
   */
  async getTodayCheckinStatus(userId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkin = await this.checkinRepository.findOne({
      where: {
        userId,
        checkinDate: today,
      },
    });

    const requiredMinutes = await this.getCheckinMinutes();

    return {
      hasCheckedIn: !!checkin,
      checkin: checkin
        ? {
            id: checkin.id,
            checkinDate: checkin.checkinDate,
            studyDuration: checkin.studyDuration,
            questionCount: checkin.questionCount,
            createTime: checkin.createTime,
          }
        : null,
      requiredMinutes,
    };
  }
}
