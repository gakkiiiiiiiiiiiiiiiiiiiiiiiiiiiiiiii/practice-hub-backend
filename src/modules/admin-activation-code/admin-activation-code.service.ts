import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { ActivationCode, ActivationCodeStatus } from '../../database/entities/activation-code.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';
import { GenerateCodeDto } from './dto/generate-code.dto';

@Injectable()
export class AdminActivationCodeService {
  constructor(
    @InjectRepository(ActivationCode)
    private activationCodeRepository: Repository<ActivationCode>,
    @InjectRepository(SysUser)
    private sysUserRepository: Repository<SysUser>,
  ) {}

  /**
   * 生成激活码
   */
  async generateCodes(agentId: number, dto: GenerateCodeDto) {
    const agent = await this.sysUserRepository.findOne({ where: { id: agentId } });

    if (!agent || agent.role !== AdminRole.AGENT) {
      throw new ForbiddenException('只有代理商可以生成激活码');
    }

    // 校验余额（如果设置了单价）
    const codePrice = dto.price || 0;
    const totalCost = codePrice * dto.count;

    if (totalCost > agent.balance) {
      throw new BadRequestException('余额不足');
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
        subject_id: dto.subject_id,
        status: ActivationCodeStatus.PENDING,
      });
    }

    // 批量插入
    await this.activationCodeRepository.save(codes);

    // 扣除余额
    if (totalCost > 0) {
      agent.balance -= totalCost;
      await this.sysUserRepository.save(agent);
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
  async getCodeList(agentId: number, role: AdminRole, page = 1, pageSize = 20) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.where('code.agent_id = :agentId', { agentId });
    }

    const [codes, total] = await queryBuilder
      .orderBy('code.create_time', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      list: codes,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 导出激活码（仅导出待用状态）
   */
  async exportCodes(agentId: number, role: AdminRole) {
    const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

    queryBuilder.where('code.status = :status', { status: ActivationCodeStatus.PENDING });

    // 数据权限隔离
    if (role === AdminRole.AGENT) {
      queryBuilder.andWhere('code.agent_id = :agentId', { agentId });
    }

    const codes = await queryBuilder.getMany();

    // 生成 Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('激活码');

    worksheet.columns = [
      { header: '激活码', key: 'code', width: 30 },
      { header: '科目ID', key: 'subject_id', width: 10 },
      { header: '批次ID', key: 'batch_id', width: 20 },
    ];

    codes.forEach((code) => {
      worksheet.addRow({
        code: code.code,
        subject_id: code.subject_id,
        batch_id: code.batch_id,
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

