import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import {
  ActivationCode,
  ActivationCodeSourceType,
  ActivationCodeStatus,
  ActivationCodeTargetType,
} from '../../database/entities/activation-code.entity';
import { Course } from '../../database/entities/course.entity';
import { PackagePlan } from '../../database/entities/package-plan.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { Distributor } from '../../database/entities/distributor.entity';
import { UserPackageSubscription } from '../../database/entities/user-package-subscription.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { GenerateCodeDto } from './dto/generate-code.dto';

@Injectable()
export class AdminActivationCodeService {
  constructor(
    @InjectRepository(ActivationCode)
    private activationCodeRepository: Repository<ActivationCode>,
    @InjectRepository(SysUser)
    private sysUserRepository: Repository<SysUser>,
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
    @InjectRepository(Distributor)
    private distributorRepository: Repository<Distributor>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(PackagePlan)
    private packagePlanRepository: Repository<PackagePlan>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private dataSource: DataSource,
  ) {}

  /**
   * 生成激活码
   */
  async generateCodes(agentId: number, dto: GenerateCodeDto) {
    const agent = await this.sysUserRepository.findOne({ where: { id: agentId } });

    if (!agent) {
      throw new ForbiddenException('用户不存在');
    }

    const target = await this.resolveCodeTarget(dto);

    // SUPER_ADMIN 可以免费生成，AGENT 需要检查余额
    if (agent.role === AdminRole.AGENT) {
      const unitPrice = dto.price ?? target.agentPrice ?? target.price ?? 0;

      // 校验余额（如果设置了单价）
      const totalCost = unitPrice * dto.count;

      if (totalCost > agent.balance) {
        throw new BadRequestException('余额不足');
      }
    }

    // 生成批次ID：通过前缀区分生成来源
    const batchPrefix = agent.role === AdminRole.AGENT ? 'AGT' : 'ADM';
    const sourceType = agent.role === AdminRole.AGENT ? ActivationCodeSourceType.AGENT : ActivationCodeSourceType.ADMIN;
    const batchId = `${batchPrefix}${agentId}${Date.now()}`;

    // 生成激活码
    const codes = [];
    for (let i = 0; i < dto.count; i++) {
      const code = this.generateCode();
      codes.push({
        code,
        batch_id: batchId,
        batch_prefix: batchPrefix,
        agent_id: agentId,
        source_type: sourceType,
        source_id: agentId,
        course_id: target.courseId,
        target_type: target.type,
        target_id: target.id,
        status: ActivationCodeStatus.PENDING,
      });
    }

    // 批量插入
    await this.activationCodeRepository.save(codes);

    // 扣除余额（仅代理商）
    if (agent.role === AdminRole.AGENT) {
      const unitPrice = dto.price ?? target.agentPrice ?? target.price ?? 0;
      const totalCost = unitPrice * dto.count;
      if (totalCost > 0) {
        agent.balance -= totalCost;
        await this.sysUserRepository.save(agent);
      }
    }

    // 生成 Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('激活码');

    worksheet.columns = [
      { header: '激活码', key: 'code', width: 30 },
      { header: '目标类型', key: 'targetType', width: 14 },
      { header: '目标名称', key: 'targetName', width: 30 },
      { header: '目标ID', key: 'targetId', width: 10 },
      { header: '批次ID', key: 'batch_id', width: 20 },
    ];

    codes.forEach((item) => {
      worksheet.addRow({
        code: item.code,
        targetType: this.getTargetTypeText(item.target_type),
        targetName: target.name,
        targetId: item.target_id || item.course_id,
        batch_id: item.batch_id,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      batch_id: batchId,
      count: codes.length,
      excel_buffer: buffer,
    };
  }

  /**
   * 获取激活码列表
   */
  async getCodeList(
    agentId: number,
    role: AdminRole,
    page = 1,
    pageSize = 20,
    batchNo?: string,
    status?: ActivationCodeStatus,
    generatorUser?: string,
  ) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.where('code.agent_id = :agentId', { agentId });
    }

    // 批次号筛选
    if (batchNo) {
      queryBuilder.andWhere('code.batch_id = :batchNo', { batchNo });
    }

    // 状态筛选
    if (status !== undefined) {
      queryBuilder.andWhere('code.status = :status', { status });
    }

    if (generatorUser?.trim()) {
      this.applyGeneratorUserFilter(queryBuilder, generatorUser.trim());
    }

    const [codes, total] = await queryBuilder
      .leftJoinAndSelect('code.course', 'course')
      .orderBy('code.create_time', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const generatorUserMap = await this.buildGeneratorUserMap(codes);

    return {
      list: await Promise.all(
        codes.map(async (code) => ({
          ...code,
          courseName: code.course?.name || '-',
          target_text: await this.getCodeTargetText(code),
          target_type_text: this.getTargetTypeText(code.target_type || ActivationCodeTargetType.COURSE),
          source_text: this.getSourceText(code),
          batch_prefix: code.batch_prefix || this.getBatchPrefix(code.batch_id),
          generator_user: generatorUserMap.get(code.id) || '-',
        })),
      ),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取激活码详情
   */
  async getCodeDetail(id: number, agentId: number, role: AdminRole) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    queryBuilder.where('code.id = :id', { id });

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.andWhere('code.agent_id = :agentId', { agentId });
    }

    const code = await queryBuilder
      .leftJoinAndSelect('code.course', 'course')
      .getOne();

    if (!code) {
      throw new BadRequestException('激活码不存在');
    }

    const generatorUserMap = await this.buildGeneratorUserMap([code]);

    return {
      ...code,
      target_text: await this.getCodeTargetText(code),
      target_type_text: this.getTargetTypeText(code.target_type || ActivationCodeTargetType.COURSE),
      source_text: this.getSourceText(code),
      batch_prefix: code.batch_prefix || this.getBatchPrefix(code.batch_id),
      generator_user: generatorUserMap.get(code.id) || '-',
    };
  }

  /**
   * 作废已使用激活码，并撤销该激活码授予的课程权限
   */
  async invalidateUsedCode(id: number, agentId: number, role: AdminRole) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const queryBuilder = queryRunner.manager
        .createQueryBuilder(ActivationCode, 'code')
        .setLock('pessimistic_write')
        .where('code.id = :id', { id });

      if (role === AdminRole.AGENT) {
        queryBuilder.andWhere('code.agent_id = :agentId', { agentId });
      }

      const code = await queryBuilder.getOne();
      if (!code) {
        throw new BadRequestException('激活码不存在');
      }

      if (code.status !== ActivationCodeStatus.USED || !code.used_by_uid) {
        throw new BadRequestException('只能禁用已激活的激活码');
      }

      code.status = ActivationCodeStatus.INVALID;
      await queryRunner.manager.save(ActivationCode, code);

      if ((code.target_type || ActivationCodeTargetType.COURSE) === ActivationCodeTargetType.PACKAGE) {
        await this.revokeCodePackageAuth(queryRunner.manager, code);
      } else {
        await this.revokeCodeCourseAuth(queryRunner.manager, code);
      }

      await queryRunner.commitTransaction();
      return { success: true };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 删除激活码
   */
  async deleteCode(id: number, agentId: number, role: AdminRole) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    queryBuilder.where('code.id = :id', { id });

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.andWhere('code.agent_id = :agentId', { agentId });
    }

    const code = await queryBuilder.getOne();

    if (!code) {
      throw new BadRequestException('激活码不存在');
    }

    // 只能删除待用状态的激活码
    if (code.status !== ActivationCodeStatus.PENDING) {
      throw new BadRequestException('只能删除待用状态的激活码');
    }

    await this.activationCodeRepository.remove(code);

    return { success: true };
  }

  /**
   * 获取激活码统计
   */
  async getCodeStatistics(agentId: number, role: AdminRole) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.where('code.agent_id = :agentId', { agentId });
    }

    const [total, pending, used, invalid] = await Promise.all([
      queryBuilder.getCount(),
      queryBuilder
        .clone()
        .andWhere('code.status = :status', { status: ActivationCodeStatus.PENDING })
        .getCount(),
      queryBuilder
        .clone()
        .andWhere('code.status = :status', { status: ActivationCodeStatus.USED })
        .getCount(),
      queryBuilder
        .clone()
        .andWhere('code.status = :status', { status: ActivationCodeStatus.INVALID })
        .getCount(),
    ]);

    return {
      total,
      pending,
      used,
      invalid,
    };
  }

  /**
   * 导出激活码（支持按批次导出）
   */
  async exportCodes(agentId: number, role: AdminRole, batchNo?: string, status?: ActivationCodeStatus) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    // 默认只导出待用状态
    if (status !== undefined) {
      queryBuilder.where('code.status = :status', { status });
    } else {
      queryBuilder.where('code.status = :status', { status: ActivationCodeStatus.PENDING });
    }

    // 批次号筛选
    if (batchNo) {
      queryBuilder.andWhere('code.batch_id = :batchNo', { batchNo });
    }

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.andWhere('code.agent_id = :agentId', { agentId });
    }

    const codes = await queryBuilder
      .leftJoinAndSelect('code.course', 'course')
      .getMany();

    // 生成 Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('激活码');

    worksheet.columns = [
      { header: '激活码', key: 'code', width: 30 },
      { header: '目标类型', key: 'targetType', width: 14 },
      { header: '目标名称', key: 'targetName', width: 30 },
      { header: '批次ID', key: 'batch_id', width: 20 },
      { header: '状态', key: 'status', width: 10 },
    ];

    for (const code of codes) {
      worksheet.addRow({
        code: code.code,
        targetType: this.getTargetTypeText(code.target_type || ActivationCodeTargetType.COURSE),
        targetName: await this.getCodeTargetText(code),
        batch_id: code.batch_id,
        status: this.getStatusText(code.status),
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return buffer;
  }

  /**
   * 生成随机激活码
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符
    let code = '';
    for (let i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private async resolveCodeTarget(dto: GenerateCodeDto) {
    const type = dto.target_type || ActivationCodeTargetType.COURSE;
    const id = Number(dto.target_id || dto.course_id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException(type === ActivationCodeTargetType.PACKAGE ? '请选择套餐/VIP计划' : '请选择目标课程');
    }

    if (type === ActivationCodeTargetType.PACKAGE) {
      const plan = await this.packagePlanRepository.findOne({ where: { id }, relations: ['section'] });
      if (!plan || plan.status === 0) {
        throw new BadRequestException('套餐计划不存在或已禁用');
      }
      if (!plan.section || plan.section.status === 0) {
        throw new BadRequestException('套餐不存在或已禁用');
      }
      return {
        type,
        id: plan.id,
        courseId: null,
        name: `${plan.section.name} - ${plan.name}`,
        price: Number(plan.price || 0),
        agentPrice: Number(plan.price || 0),
      };
    }

    const course = await this.courseRepository.findOne({ where: { id } });
    if (!course) {
      throw new BadRequestException('课程不存在');
    }
    return {
      type: ActivationCodeTargetType.COURSE,
      id: course.id,
      courseId: course.id,
      name: course.name,
      price: Number(course.price || 0),
      agentPrice: Number(course.agent_price || course.price || 0),
    };
  }

  private async getCodeTargetText(code: ActivationCode) {
    const targetType = code.target_type || ActivationCodeTargetType.COURSE;
    if (targetType === ActivationCodeTargetType.PACKAGE) {
      const plan = code.target_id
        ? await this.packagePlanRepository.findOne({ where: { id: code.target_id }, relations: ['section'] })
        : null;
      return plan ? `${plan.section?.name || '套餐'} - ${plan.name}` : '套餐/VIP';
    }
    return code.course?.name || '-';
  }

  private getTargetTypeText(type: ActivationCodeTargetType) {
    return type === ActivationCodeTargetType.PACKAGE ? '套餐/VIP' : '课程';
  }

  private async revokeCodeCourseAuth(manager: any, code: ActivationCode) {
    if (!code.used_by_uid) {
      return;
    }

    const paidOrder = await manager.findOne(Order, {
      where: {
        user_id: code.used_by_uid,
        course_id: code.course_id,
        status: OrderStatus.PAID,
      },
    });
    if (paidOrder) {
      return;
    }

    const otherUsedCodeCount = await manager.count(ActivationCode, {
      where: {
        used_by_uid: code.used_by_uid,
        course_id: code.course_id,
        status: ActivationCodeStatus.USED,
      },
    });
    if (otherUsedCodeCount > 0) {
      return;
    }

    await manager.delete(UserCourseAuth, {
      user_id: code.used_by_uid,
      course_id: code.course_id,
      source: AuthSource.CODE,
    });
  }

  private async revokeCodePackageAuth(manager: any, code: ActivationCode) {
    if (!code.used_by_uid || !code.target_id) {
      return;
    }
    const plan = await manager.findOne(PackagePlan, { where: { id: code.target_id } });
    if (!plan) return;

    const paidOrder = await manager.findOne(Order, {
      where: {
        user_id: code.used_by_uid,
        package_section_id: plan.section_id,
        package_plan_id: plan.id,
        status: OrderStatus.PAID,
      },
    });
    if (paidOrder) {
      return;
    }

    const otherUsedCodeCount = await manager.count(ActivationCode, {
      where: {
        used_by_uid: code.used_by_uid,
        target_type: ActivationCodeTargetType.PACKAGE,
        target_id: code.target_id,
        status: ActivationCodeStatus.USED,
      },
    });
    if (otherUsedCodeCount > 0) {
      return;
    }

    await manager.delete(UserPackageSubscription, {
      user_id: code.used_by_uid,
      section_id: plan.section_id,
      order_id: null,
    });
    await this.syncUserPackageExpireTime(manager, code.used_by_uid);
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

  private getBatchPrefix(batchId?: string) {
    if (!batchId) return '-';
    if (batchId.startsWith('DST')) return 'DST';
    if (batchId.startsWith('APP')) return 'APP';
    if (batchId.startsWith('ADM')) return 'ADM';
    if (batchId.startsWith('AGT')) return 'AGT';
    if (batchId.startsWith('D')) return 'D';
    return 'BATCH';
  }

  private getSourceText(code: ActivationCode) {
    const sourceType = code.source_type || (code.batch_id?.startsWith('D') ? ActivationCodeSourceType.DISTRIBUTOR : ActivationCodeSourceType.ADMIN);
    const textMap: Record<string, string> = {
      [ActivationCodeSourceType.ADMIN]: '管理端生成',
      [ActivationCodeSourceType.AGENT]: '代理商生成',
      [ActivationCodeSourceType.DISTRIBUTOR]: '分销购买',
      [ActivationCodeSourceType.APP_ADMIN]: '小程序管理员生成',
    };
    return textMap[sourceType] || '未知来源';
  }

  private applyGeneratorUserFilter(
    queryBuilder: ReturnType<Repository<ActivationCode>['createQueryBuilder']>,
    generatorUser: string,
  ) {
    const keyword = `%${generatorUser}%`;
    queryBuilder.andWhere(
      new Brackets((qb) => {
        qb.where(
          `(
            (code.source_type IN (:...sysTypes) OR (code.source_type IS NULL AND (code.batch_id NOT LIKE 'D%' OR code.batch_id IS NULL)))
            AND EXISTS (
              SELECT 1 FROM sys_user su
              WHERE su.id = COALESCE(code.source_id, code.agent_id)
              AND su.username LIKE :keyword
            )
          )`,
          {
            sysTypes: [ActivationCodeSourceType.ADMIN, ActivationCodeSourceType.AGENT],
            keyword,
          },
        )
          .orWhere(
            `(
              code.source_type = :appAdminType
              AND EXISTS (
                SELECT 1 FROM app_user au
                WHERE au.id = COALESCE(code.source_id, code.agent_id)
                AND au.nickname LIKE :keyword
              )
            )`,
            { appAdminType: ActivationCodeSourceType.APP_ADMIN, keyword },
          )
          .orWhere(
            `(
              (code.source_type = :distributorType OR (code.source_type IS NULL AND code.batch_id LIKE 'D%'))
              AND EXISTS (
                SELECT 1 FROM distributor d
                LEFT JOIN app_user au ON au.id = d.user_id
                WHERE d.id = COALESCE(code.source_id, code.agent_id)
                AND (au.nickname LIKE :keyword OR d.distributor_code LIKE :keyword)
              )
            )`,
            { distributorType: ActivationCodeSourceType.DISTRIBUTOR, keyword },
          );
      }),
    );
  }

  private async buildGeneratorUserMap(codes: ActivationCode[]) {
    const result = new Map<number, string>();
    if (!codes.length) {
      return result;
    }

    const sysUserIds = new Set<number>();
    const appUserIds = new Set<number>();
    const distributorIds = new Set<number>();

    for (const code of codes) {
      const sourceType =
        code.source_type ||
        (code.batch_id?.startsWith('D') ? ActivationCodeSourceType.DISTRIBUTOR : ActivationCodeSourceType.ADMIN);
      const sourceId = code.source_id || code.agent_id;
      if (!sourceId) continue;

      if (sourceType === ActivationCodeSourceType.ADMIN || sourceType === ActivationCodeSourceType.AGENT) {
        sysUserIds.add(sourceId);
      } else if (sourceType === ActivationCodeSourceType.APP_ADMIN) {
        appUserIds.add(sourceId);
      } else if (sourceType === ActivationCodeSourceType.DISTRIBUTOR) {
        distributorIds.add(sourceId);
      }
    }

    const [sysUsers, appUsers, distributors] = await Promise.all([
      sysUserIds.size
        ? this.sysUserRepository.find({ where: { id: In([...sysUserIds]) }, select: ['id', 'username'] })
        : Promise.resolve([]),
      appUserIds.size
        ? this.appUserRepository.find({ where: { id: In([...appUserIds]) }, select: ['id', 'nickname'] })
        : Promise.resolve([]),
      distributorIds.size
        ? this.distributorRepository.find({
            where: { id: In([...distributorIds]) },
            relations: ['user'],
          })
        : Promise.resolve([]),
    ]);

    const sysUserMap = new Map(sysUsers.map((item) => [item.id, item.username]));
    const appUserMap = new Map(appUsers.map((item) => [item.id, item.nickname || `用户${item.id}`]));

    for (const code of codes) {
      const sourceType =
        code.source_type ||
        (code.batch_id?.startsWith('D') ? ActivationCodeSourceType.DISTRIBUTOR : ActivationCodeSourceType.ADMIN);
      const sourceId = code.source_id || code.agent_id;
      if (!sourceId) {
        result.set(code.id, '-');
        continue;
      }

      if (sourceType === ActivationCodeSourceType.ADMIN || sourceType === ActivationCodeSourceType.AGENT) {
        result.set(code.id, sysUserMap.get(sourceId) || `管理员${sourceId}`);
        continue;
      }

      if (sourceType === ActivationCodeSourceType.APP_ADMIN) {
        result.set(code.id, appUserMap.get(sourceId) || `小程序用户${sourceId}`);
        continue;
      }

      if (sourceType === ActivationCodeSourceType.DISTRIBUTOR) {
        const distributor = distributors.find((item) => item.id === sourceId);
        const nickname = distributor?.user?.nickname;
        result.set(code.id, nickname || distributor?.distributor_code || `分销商${sourceId}`);
        continue;
      }

      result.set(code.id, '-');
    }

    return result;
  }

  private getStatusText(status: ActivationCodeStatus) {
    return status === ActivationCodeStatus.PENDING ? '待用' : status === ActivationCodeStatus.USED ? '已用' : '作废';
  }
}
