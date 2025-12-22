import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order } from '../../database/entities/order.entity';
import { ActivationCode } from '../../database/entities/activation-code.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(AppUser)
    private appUserRepository: Repository<AppUser>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(ActivationCode)
    private activationCodeRepository: Repository<ActivationCode>,
    @InjectRepository(SysUser)
    private sysUserRepository: Repository<SysUser>,
  ) {}

  /**
   * 系统总览数据（SuperAdmin）
   */
  async getOverviewStats() {
    const userCount = await this.appUserRepository.count();
    const orderCount = await this.orderRepository.count();
    const totalRevenue = await this.orderRepository
      .createQueryBuilder('order')
      .select('SUM(order.amount)', 'total')
      .where('order.status = :status', { status: 'paid' })
      .getRawOne();

    return {
      user_count: userCount,
      order_count: orderCount,
      total_revenue: totalRevenue?.total || 0,
    };
  }

  /**
   * 代理商个人数据（Agent）
   */
  async getAgentStats(agentId: number) {
    const agent = await this.sysUserRepository.findOne({ where: { id: agentId } });

    if (!agent || agent.role !== AdminRole.AGENT) {
      throw new Error('代理商不存在');
    }

    // 统计激活码库存（待用状态）
    const codeStock = await this.activationCodeRepository.count({
      where: {
        agent_id: agentId,
        status: 0, // PENDING
      },
    });

    return {
      balance: agent.balance,
      code_stock: codeStock,
    };
  }
}

