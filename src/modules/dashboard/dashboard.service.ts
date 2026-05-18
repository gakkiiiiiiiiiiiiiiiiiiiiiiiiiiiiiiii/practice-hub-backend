import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { ActivationCode } from '../../database/entities/activation-code.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { UserFileCourseProgress } from '../../database/entities/user-file-course-progress.entity';

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
    @InjectRepository(UserAnswerLog)
    private answerLogRepository: Repository<UserAnswerLog>,
    @InjectRepository(UserFileCourseProgress)
    private fileProgressRepository: Repository<UserFileCourseProgress>,
  ) {}

  /**
   * 系统总览数据（SuperAdmin）
   */
  async getOverviewStats() {
    const todayStart = this.getDayStart();
    const tomorrowStart = this.addDays(todayStart, 1);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const tomorrowEnd = tomorrowStart;

    const [
      totalUsers,
      todayUsers,
      todayAnswerViews,
      todayFileViews,
      todayOrders,
      monthOrders,
      todayRevenue,
      monthRevenue,
      totalRevenue,
      trend,
    ] = await Promise.all([
      this.appUserRepository.count(),
      this.appUserRepository
        .createQueryBuilder('user')
        .where('user.create_time >= :start AND user.create_time < :end', { start: todayStart, end: tomorrowEnd })
        .getCount(),
      this.answerLogRepository
        .createQueryBuilder('log')
        .where('log.create_time >= :start AND log.create_time < :end', { start: todayStart, end: tomorrowEnd })
        .getCount(),
      this.fileProgressRepository
        .createQueryBuilder('progress')
        .where('progress.update_time >= :start AND progress.update_time < :end', { start: todayStart, end: tomorrowEnd })
        .getCount(),
      this.orderRepository
        .createQueryBuilder('order')
        .where('order.create_time >= :start AND order.create_time < :end', { start: todayStart, end: tomorrowEnd })
        .getCount(),
      this.orderRepository
        .createQueryBuilder('order')
        .where('order.create_time >= :start AND order.create_time < :end', { start: monthStart, end: tomorrowEnd })
        .getCount(),
      this.sumPaidOrderAmount(todayStart, tomorrowEnd),
      this.sumPaidOrderAmount(monthStart, tomorrowEnd),
      this.sumPaidOrderAmount(),
      this.getRecentTrend(7),
    ]);

    return {
      totalUsers,
      todayUsers,
      todayViews: todayAnswerViews + todayFileViews,
      todayOrders,
      monthOrders,
      todayRevenue,
      monthRevenue,
      totalRevenue,
      // 保持旧字段兼容
      user_count: totalUsers,
      order_count: monthOrders,
      total_revenue: totalRevenue,
      trend,
    };
  }

  private getDayStart(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDate(date: Date) {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${month}-${day}`;
  }

  private async sumPaidOrderAmount(start?: Date, end?: Date) {
    const query = this.orderRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.amount), 0)', 'total')
      .where('order.status = :status', { status: OrderStatus.PAID });

    if (start && end) {
      query.andWhere('COALESCE(order.paid_time, order.update_time, order.create_time) >= :start', { start });
      query.andWhere('COALESCE(order.paid_time, order.update_time, order.create_time) < :end', { end });
    }

    const result = await query.getRawOne();
    return Number(result?.total || 0);
  }

  private async getRecentTrend(days: number) {
    const todayStart = this.getDayStart();
    const dates = Array.from({ length: days }, (_, index) => this.addDays(todayStart, index - days + 1));

    return Promise.all(
      dates.map(async (date) => {
        const next = this.addDays(date, 1);
        const [newUsers, answerViews, fileViews, orders, revenue] = await Promise.all([
          this.appUserRepository
            .createQueryBuilder('user')
            .where('user.create_time >= :start AND user.create_time < :end', { start: date, end: next })
            .getCount(),
          this.answerLogRepository
            .createQueryBuilder('log')
            .where('log.create_time >= :start AND log.create_time < :end', { start: date, end: next })
            .getCount(),
          this.fileProgressRepository
            .createQueryBuilder('progress')
            .where('progress.update_time >= :start AND progress.update_time < :end', { start: date, end: next })
            .getCount(),
          this.orderRepository
            .createQueryBuilder('order')
            .where('order.create_time >= :start AND order.create_time < :end', { start: date, end: next })
            .getCount(),
          this.sumPaidOrderAmount(date, next),
        ]);

        return {
          date: this.formatDate(date),
          newUsers,
          views: answerViews + fileViews,
          orders,
          revenue,
        };
      }),
    );
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
