import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { ActivationCode, ActivationCodeStatus } from '../../database/entities/activation-code.entity';
import { Course } from '../../database/entities/course.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';
import { GenerateCodeDto } from './dto/generate-code.dto';

@Injectable()
export class AdminActivationCodeService {
  constructor(
    @InjectRepository(ActivationCode)
    private activationCodeRepository: Repository<ActivationCode>,
    @InjectRepository(SysUser)
    private sysUserRepository: Repository<SysUser>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  /**
   * 生成激活码
   */
  async generateCodes(agentId: number, dto: GenerateCodeDto) {
    const agent = await this.sysUserRepository.findOne({ where: { id: agentId } });

    if (!agent) {
      throw new ForbiddenException('用户不存在');
    }

    // SUPER_ADMIN 可以免费生成，AGENT 需要检查余额
    if (agent.role === AdminRole.AGENT) {
      const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });
      if (!course) {
        throw new BadRequestException('课程不存在');
      }

      const unitPrice = dto.price ?? course.agent_price ?? course.price ?? 0;

      // 校验余额（如果设置了单价）
      const totalCost = unitPrice * dto.count;

      if (totalCost > agent.balance) {
        throw new BadRequestException('余额不足');
      }
    }

    // 生成批次ID
    const batchId = `BATCH${Date.now()}`;

    // 生成激活码
    const codes = [];
    for (let i = 0; i < dto.count; i++) {
      const code = this.generateCode();
      codes.push({
        code,
        batch_id: batchId,
        agent_id: agentId,
        course_id: dto.course_id,
        status: ActivationCodeStatus.PENDING,
      });
    }

    // 批量插入
    await this.activationCodeRepository.save(codes);

    // 扣除余额（仅代理商）
    if (agent.role === AdminRole.AGENT) {
      const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });
      const unitPrice = dto.price ?? course?.agent_price ?? course?.price ?? 0;
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
      { header: '科目ID', key: 'subject_id', width: 10 },
      { header: '批次ID', key: 'batch_id', width: 20 },
    ];

    codes.forEach((item) => {
      worksheet.addRow({
        code: item.code,
        subject_id: item.subject_id,
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

    const [codes, total] = await queryBuilder
      .leftJoinAndSelect('code.course', 'course')
      .orderBy('code.create_time', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      list: codes.map((code) => ({
        ...code,
        courseName: code.course?.name || '-',
      })),
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

    return code;
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
      { header: '课程名称', key: 'courseName', width: 30 },
      { header: '批次ID', key: 'batch_id', width: 20 },
      { header: '状态', key: 'status', width: 10 },
    ];

    codes.forEach((code) => {
      worksheet.addRow({
        code: code.code,
        courseName: code.course?.name || '-',
        batch_id: code.batch_id,
        status: code.status === ActivationCodeStatus.PENDING ? '待用' : code.status === ActivationCodeStatus.USED ? '已用' : '作废',
      });
    });

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
}

