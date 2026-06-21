import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ActivationCode, ActivationCodeStatus, ActivationCodeTargetType } from '../../database/entities/activation-code.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { PackagePlan } from '../../database/entities/package-plan.entity';
import { UserPackageSubscription } from '../../database/entities/user-package-subscription.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';

@Injectable()
export class ActivationCodeService {
  constructor(
    @InjectRepository(ActivationCode)
    private activationCodeRepository: Repository<ActivationCode>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    @InjectRepository(PackagePlan)
    private packagePlanRepository: Repository<PackagePlan>,
    @InjectRepository(UserPackageSubscription)
    private userPackageSubscriptionRepository: Repository<UserPackageSubscription>,
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
    private dataSource: DataSource,
  ) {}

  /**
   * 激活前预览课程信息，不消耗激活码
   */
  async previewCode(code: string) {
    const activationCode = await this.activationCodeRepository.findOne({
      where: { code, status: ActivationCodeStatus.PENDING },
      relations: ['course'],
    });

    if (!activationCode) {
      throw new BadRequestException('激活码无效或已使用');
    }
    const targetType = activationCode.target_type || ActivationCodeTargetType.COURSE;
    if (targetType === ActivationCodeTargetType.PACKAGE) {
      const plan = activationCode.target_id
        ? await this.packagePlanRepository.findOne({ where: { id: activationCode.target_id }, relations: ['section'] })
        : null;
      if (!plan || !plan.section) {
        throw new NotFoundException('激活码对应套餐不存在');
      }
      return {
        code: activationCode.code,
        target_type: targetType,
        target_id: plan.id,
        package_plan_id: plan.id,
        package_section_id: plan.section_id,
        package_name: plan.section.name,
        plan_name: plan.name,
        duration_days: plan.duration_days,
        course_id: null,
        course_name: '',
        package: {
          id: plan.section.id,
          name: plan.section.name,
          cover_img: plan.section.cover_img,
          plan: {
            id: plan.id,
            name: plan.name,
            duration_days: plan.duration_days,
          },
        },
      };
    }

    if (!activationCode.course) {
      throw new NotFoundException('激活码对应课程不存在');
    }

    return {
      code: activationCode.code,
      target_type: ActivationCodeTargetType.COURSE,
      target_id: activationCode.target_id || activationCode.course_id,
      course_id: activationCode.course_id,
      course_name: activationCode.course.name,
      course: {
        id: activationCode.course.id,
        name: activationCode.course.name,
        category: activationCode.course.category,
        sub_category: activationCode.course.sub_category,
        cover_img: activationCode.course.cover_img,
      },
    };
  }

  /**
   * 激活码核销（并发安全）
   */
  async redeemCode(userId: number, code: string) {
    // 开启事务
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. 查询激活码
      const activationCode = await queryRunner.manager.findOne(ActivationCode, {
        where: { code, status: ActivationCodeStatus.PENDING },
        relations: ['course'],
      });

      if (!activationCode) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException('激活码无效或已使用');
      }

      // 2. 使用乐观锁更新状态
      const updateResult = await queryRunner.manager.update(
        ActivationCode,
        { code, status: ActivationCodeStatus.PENDING },
        {
          status: ActivationCodeStatus.USED,
          used_by_uid: userId,
          used_time: new Date(),
        },
      );

      // 3. 判断影响行数
      if (updateResult.affected === 0) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException('激活码已被使用，请重试');
      }

      const targetType = activationCode.target_type || ActivationCodeTargetType.COURSE;
      if (targetType === ActivationCodeTargetType.PACKAGE) {
        await this.grantPackageByCode(queryRunner.manager, userId, activationCode);
      } else {
        await this.grantCourseByCode(queryRunner.manager, userId, activationCode);
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        target_type: targetType,
        course_id: activationCode.course_id,
        course_name: activationCode.course?.name || '',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async grantCourseByCode(manager: any, userId: number, activationCode: ActivationCode) {
    if (!activationCode.course_id) {
      throw new BadRequestException('激活码课程信息缺失');
    }
    const existingAuth = await manager.findOne(UserCourseAuth, {
      where: {
        user_id: userId,
        course_id: activationCode.course_id,
      },
    });

    if (!existingAuth) {
      await manager.save(UserCourseAuth, {
        user_id: userId,
        course_id: activationCode.course_id,
        source: AuthSource.CODE,
        expire_time: null,
      });
    }
  }

  private async grantPackageByCode(manager: any, userId: number, activationCode: ActivationCode) {
    if (!activationCode.target_id) {
      throw new BadRequestException('激活码套餐信息缺失');
    }
    const plan = await manager.findOne(PackagePlan, {
      where: { id: activationCode.target_id },
    });
    if (!plan || plan.status === 0) {
      throw new BadRequestException('套餐计划不存在或已禁用');
    }

    const now = new Date();
    let subscription = await manager.findOne(UserPackageSubscription, {
      where: { user_id: userId, section_id: plan.section_id },
    });
    const baseTime = subscription && subscription.expire_time > now ? subscription.expire_time : now;
    const expireTime = new Date(baseTime);
    expireTime.setDate(expireTime.getDate() + plan.duration_days);

    if (!subscription) {
      subscription = manager.create(UserPackageSubscription, {
        user_id: userId,
        section_id: plan.section_id,
        expire_time: expireTime,
        order_id: null,
      });
    } else {
      subscription.expire_time = expireTime;
      subscription.order_id = null;
    }
    await manager.save(UserPackageSubscription, subscription);
    await this.syncUserPackageExpireTime(manager, userId);
  }

  private async syncUserPackageExpireTime(manager: any, userId: number) {
    const subscriptions = await manager.find(UserPackageSubscription, { where: { user_id: userId } });
    const now = new Date();
    let maxExpire: Date | null = null;
    for (const item of subscriptions) {
      if (item.expire_time <= now) continue;
      if (!maxExpire || item.expire_time > maxExpire) {
        maxExpire = item.expire_time;
      }
    }
    await manager.update(AppUser, userId, { package_expire_time: maxExpire });
  }
}
