import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ActivationCode, ActivationCodeSourceType, ActivationCodeStatus, ActivationCodeTargetType } from '../../database/entities/activation-code.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { PackagePlan } from '../../database/entities/package-plan.entity';
import { UserPackageSubscription } from '../../database/entities/user-package-subscription.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { UserPointsLog, UserPointsLogType } from '../../database/entities/user-points-log.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { UserCategoryBundleAccess } from '../../database/entities/user-category-bundle-access.entity';
import { Distributor } from '../../database/entities/distributor.entity';
import { requestCoursePreviewDemand, requestUserPreviewDemand } from '../course/preview-demand.util';
import { DistributorService } from '../distributor/distributor.service';
import { grantTrackedPackageDuration } from '../package/package-entitlement-ledger';

@Injectable()
export class ActivationCodeService {
  private readonly logger = new Logger(ActivationCodeService.name);

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
    @InjectRepository(CourseCategory)
    private courseCategoryRepository: Repository<CourseCategory>,
    private dataSource: DataSource,
    @Inject(forwardRef(() => DistributorService))
    private distributorService: DistributorService,
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
    if (targetType === ActivationCodeTargetType.AGENT) {
      const agentLevel = this.getAgentLevel(activationCode);
      const agentLevelName = this.getAgentLevelName(agentLevel);
      return {
        code: activationCode.code,
        target_type: targetType,
        target_id: null,
        course_id: null,
        course_name: '',
        identity_name: agentLevelName,
        agent_level: agentLevel,
        agent_level_name: agentLevelName,
        benefits: ['按代理商价格购买课程激活码', '管理已购买的激活码', '使用分销推广功能'],
      };
    }
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
    if (targetType === ActivationCodeTargetType.CATEGORY_BUNDLE) {
      const category = activationCode.target_id
        ? await this.courseCategoryRepository.findOne({ where: { id: activationCode.target_id } })
        : null;
      if (!category || category.status === 0 || Number(category.bundle_enabled ?? 1) !== 1) {
        throw new NotFoundException('激活码对应类目套餐不存在或已关闭');
      }
      const parent = category.parent_id
        ? await this.courseCategoryRepository.findOne({ where: { id: category.parent_id } })
        : null;
      return {
        code: activationCode.code,
        target_type: targetType,
        target_id: category.id,
        category_id: category.id,
        category_name: category.name,
        primary_category_name: parent?.name || category.name,
        category_bundle_name: parent ? `${parent.name} / ${category.name}` : category.name,
        course_id: null,
        course_name: '',
      };
    }
    if (targetType === ActivationCodeTargetType.POINTS) {
      const pointsAmount = this.getPointsAmount(activationCode);
      return {
        code: activationCode.code,
        target_type: targetType,
        target_id: null,
        points_amount: pointsAmount,
        course_id: null,
        course_name: '',
      };
    }
    if (targetType === ActivationCodeTargetType.COUPON) {
      const coupon = this.getCouponReward(activationCode);
      return {
        code: activationCode.code,
        target_type: targetType,
        target_id: null,
        coupon_amount: coupon.amount,
        coupon_min_amount: coupon.minAmount,
        coupon_valid_days: coupon.validDays,
        course_id: null,
        course_name: '',
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
    const queryRunner = this.dataSource.createQueryRunner();
    let redemptionResult: Record<string, unknown> | null = null;
    let previewTarget: {
      targetType: ActivationCodeTargetType;
      courseId: number | null;
    } | null = null;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // 先锁激活码，再锁用户；与阿奇索退款使用相同顺序，避免核销和退款互相覆盖权益。
      const lockedCodes = await queryRunner.manager.query(
        'SELECT id FROM activation_code WHERE code = ? AND status = ? FOR UPDATE',
        [code, ActivationCodeStatus.PENDING],
      );
      if (lockedCodes.length !== 1) {
        throw new BadRequestException('激活码无效或已使用');
      }

      // 1. 查询激活码
      const activationCode = await queryRunner.manager.findOne(ActivationCode, {
        where: { code, status: ActivationCodeStatus.PENDING },
        relations: ['course'],
      });

      if (!activationCode) {
        throw new BadRequestException('激活码无效或已使用');
      }

      const targetType = activationCode.target_type || ActivationCodeTargetType.COURSE;
      if (targetType === ActivationCodeTargetType.COURSE && activationCode.course_id) {
        // 同一用户的资料码核销串行化，避免并发使用两枚同资料激活码时都通过重复校验。
        await queryRunner.manager.findOne(AppUser, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        const existingAuth = await queryRunner.manager.findOne(UserCourseAuth, {
          where: {
            user_id: userId,
            course_id: activationCode.course_id,
          },
        });
        if (existingAuth) {
          throw new BadRequestException('您已拥有该资料，激活码未消耗');
        }
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
        throw new BadRequestException('激活码已被使用，请重试');
      }

      let agentIdentity: Distributor | null = null;
      if (targetType === ActivationCodeTargetType.AGENT) {
        await this.distributorService.assertDistributionEnabled();
        agentIdentity = await this.grantAgentByCode(queryRunner.manager, userId, activationCode);
        await this.distributorService.evaluateUplinePromotion(userId, queryRunner.manager);
      } else if (targetType === ActivationCodeTargetType.PACKAGE) {
        await this.grantPackageByCode(queryRunner.manager, userId, activationCode);
      } else if (targetType === ActivationCodeTargetType.CATEGORY_BUNDLE) {
        await this.grantCategoryBundleByCode(queryRunner.manager, userId, activationCode);
      } else if (targetType === ActivationCodeTargetType.POINTS) {
        await this.grantPointsByCode(queryRunner.manager, userId, activationCode);
      } else if (targetType === ActivationCodeTargetType.COUPON) {
        await this.grantCouponByCode(queryRunner.manager, userId, activationCode);
      } else {
        await this.grantCourseByCode(queryRunner.manager, userId, activationCode);
      }

      if (activationCode.source_type === ActivationCodeSourceType.AGISO) {
        await queryRunner.manager.query(
          'INSERT INTO agiso_code_grant (activation_code_id, user_id, target_type, target_id, granted_at, duration_days, revoked_at) VALUES (?, ?, ?, ?, NOW(), ?, NULL)',
          [
            activationCode.id,
            userId,
            targetType,
            activationCode.target_id || activationCode.course_id,
            targetType === ActivationCodeTargetType.PACKAGE
              ? (await queryRunner.manager.findOne(PackagePlan, { where: { id: activationCode.target_id } }))?.duration_days ?? null
              : null,
          ],
        );
      }

      await queryRunner.commitTransaction();

      if (
        targetType === ActivationCodeTargetType.COURSE ||
        targetType === ActivationCodeTargetType.PACKAGE ||
        targetType === ActivationCodeTargetType.CATEGORY_BUNDLE
      ) {
        previewTarget = { targetType, courseId: activationCode.course_id };
      }

      redemptionResult = {
        success: true,
        target_type: targetType,
        course_id: activationCode.course_id,
        course_name: activationCode.course?.name || '',
        ...(targetType === ActivationCodeTargetType.AGENT
          ? {
              is_agent: true,
              distributor_code: agentIdentity?.distributor_code || '',
              agent_level: agentIdentity?.agent_level || 1,
              agent_level_name: this.getAgentLevelName(agentIdentity?.agent_level),
              message: `${this.getAgentLevelName(agentIdentity?.agent_level)}身份激活成功`,
            }
          : {}),
        ...(targetType === ActivationCodeTargetType.CATEGORY_BUNDLE
          ? { category_id: activationCode.target_id }
          : {}),
        ...(targetType === ActivationCodeTargetType.POINTS
          ? { points_amount: this.getPointsAmount(activationCode) }
          : {}),
        ...(targetType === ActivationCodeTargetType.COUPON
          ? {
              coupon_amount: this.getCouponReward(activationCode).amount,
              coupon_min_amount: this.getCouponReward(activationCode).minAmount,
              coupon_valid_days: this.getCouponReward(activationCode).validDays,
            }
          : {}),
      };
    } catch (error) {
      if (queryRunner.isTransactionActive !== false) {
        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackError) {
          this.logger.error('激活码事务回滚失败', rollbackError instanceof Error ? rollbackError.stack : undefined);
        }
      }
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (previewTarget) {
      await this.requestPreviewDemandAfterCommit(userId, previewTarget);
    }

    return redemptionResult;
  }

  private async requestPreviewDemandAfterCommit(
    userId: number,
    target: { targetType: ActivationCodeTargetType; courseId: number | null },
  ): Promise<void> {
    const requestDemand = () =>
      target.targetType === ActivationCodeTargetType.COURSE && target.courseId
        ? requestCoursePreviewDemand(this.dataSource.manager, target.courseId)
        : requestUserPreviewDemand(this.dataSource.manager, userId);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await requestDemand();
        return;
      } catch (error) {
        const isDeadlock = this.isDeadlockError(error);
        if (isDeadlock && attempt < 2) continue;

        this.logger.warn(
          `激活已成功，预览生成任务标记失败: userId=${userId}, targetType=${target.targetType}, courseId=${target.courseId || 0}`,
        );
        return;
      }
    }
  }

  private isDeadlockError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const databaseError = error as {
      code?: string;
      errno?: number;
      sqlMessage?: string;
      message?: string;
    };
    return (
      databaseError.code === 'ER_LOCK_DEADLOCK' ||
      Number(databaseError.errno) === 1213 ||
      /deadlock/i.test(String(databaseError.sqlMessage || databaseError.message || ''))
    );
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

  private async grantAgentByCode(manager: any, userId: number, activationCode: ActivationCode): Promise<Distributor> {
    const agentLevel = this.getAgentLevel(activationCode);
    const existing = await manager.findOne(Distributor, {
      where: { user_id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing?.status === 1 && Number(existing.agent_level || 1) === agentLevel) {
      throw new BadRequestException('您已经是代理商，无需重复激活');
    }
    if (existing) {
      existing.status = 1;
	  existing.agent_level = agentLevel;
      existing.reject_reason = null;
      return manager.save(Distributor, existing);
    }
    const distributor = manager.create(Distributor, {
      user_id: userId,
      distributor_code: this.generateDistributorCode(userId),
      status: 1,
	  agent_level: agentLevel,
    });
    return manager.save(Distributor, distributor);
  }

  private generateDistributorCode(userId: number): string {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `D${userId}${timestamp}${random}`;
  }

  private getAgentLevel(activationCode: ActivationCode): number {
    const requestedLevel = Number(activationCode.reward_payload?.agent_level || 1);
    return Number.isInteger(requestedLevel) && requestedLevel >= 1 && requestedLevel <= 3 ? requestedLevel : 1;
  }

  private getAgentLevelName(value: unknown): string {
    const level = Number(value);
    const normalizedLevel = Number.isInteger(level) && level >= 1 && level <= 3 ? level : 1;
    return ['初级代理', '中级代理', '高级代理'][normalizedLevel - 1];
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

    await grantTrackedPackageDuration(manager, {
      userId,
      sectionId: plan.section_id,
      durationDays: plan.duration_days,
      sourceType: 'code',
      sourceId: activationCode.id,
    });
  }

  private async grantCategoryBundleByCode(manager: any, userId: number, activationCode: ActivationCode) {
    if (!activationCode.target_id) {
      throw new BadRequestException('激活码类目套餐信息缺失');
    }
    const category = await manager.findOne(CourseCategory, {
      where: { id: activationCode.target_id },
    });
    if (!category || category.status === 0 || Number(category.bundle_enabled ?? 1) !== 1) {
      throw new BadRequestException('类目套餐不存在或已关闭');
    }
    const existingAccess = await manager.findOne(UserCategoryBundleAccess, {
      where: { user_id: userId, category_id: category.id },
    });
    if (existingAccess) {
      throw new BadRequestException('您已拥有该类目套餐，无需重复激活');
    }
    await manager.save(
      UserCategoryBundleAccess,
      manager.create(UserCategoryBundleAccess, {
        user_id: userId,
        category_id: category.id,
        order_id: null,
        activation_code_id: activationCode.id,
      }),
    );
  }

  private async grantPointsByCode(manager: any, userId: number, activationCode: ActivationCode) {
    const amount = this.getPointsAmount(activationCode);
    const user = await manager.findOne(AppUser, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('用户不存在');

    user.points_balance = Math.max(0, Number(user.points_balance || 0)) + amount;
    await manager.save(AppUser, user);
    await manager.save(
      UserPointsLog,
      manager.create(UserPointsLog, {
        userId,
        changeAmount: amount,
        balanceAfter: user.points_balance,
        type: UserPointsLogType.ADJUST,
        remark: '积分激活码兑换',
      }),
    );
  }

  private async grantCouponByCode(manager: any, userId: number, activationCode: ActivationCode) {
    const reward = this.getCouponReward(activationCode);
    let expireTime: Date | null = null;
    if (reward.validDays !== null) {
      expireTime = new Date();
      expireTime.setDate(expireTime.getDate() + reward.validDays);
    }
    await manager.save(
      UserCoupon,
      manager.create(UserCoupon, {
        user_id: userId,
        amount: reward.amount,
        min_amount: reward.minAmount,
        status: UserCouponStatus.UNUSED,
        source: 'activation_code',
        used_order_id: null,
        expire_time: expireTime,
      }),
    );
  }

  private getPointsAmount(activationCode: ActivationCode) {
    const amount = Number(activationCode.reward_payload?.points_amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
      throw new BadRequestException('激活码积分配置无效');
    }
    return amount;
  }

  private getCouponReward(activationCode: ActivationCode) {
    const amount = Number(activationCode.reward_payload?.coupon_amount);
    const minAmount = Number(activationCode.reward_payload?.coupon_min_amount || 0);
    const rawValidDays = activationCode.reward_payload?.coupon_valid_days;
    const validDays = rawValidDays === null || rawValidDays === undefined ? null : Number(rawValidDays);
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
      throw new BadRequestException('激活码优惠券面额无效');
    }
    if (!Number.isFinite(minAmount) || minAmount < 0 || minAmount > 100000000) {
      throw new BadRequestException('激活码优惠券门槛无效');
    }
    if (validDays !== null && (!Number.isInteger(validDays) || validDays < 1 || validDays > 3650)) {
      throw new BadRequestException('激活码优惠券有效期无效');
    }
    return { amount, minAmount, validDays };
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
