import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as https from 'https';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { ActivationCode } from '../../database/entities/activation-code.entity';
import { SysUser, AdminRole } from '../../database/entities/sys-user.entity';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { UserFileCourseProgress } from '../../database/entities/user-file-course-progress.entity';

export interface WechatVisitTrendItem {
  date: string;
  openCount: number;
  visitPv: number;
  visitors: number;
  newUsers: number;
}

export interface WechatAnalytics {
  enabled: boolean;
  source: 'wechat_datacube' | 'business_fallback';
  date?: string;
  cumulativeUsers?: number;
  openCount?: number;
  visitPv?: number;
  visitors?: number;
  newUsers?: number;
  trend?: WechatVisitTrendItem[];
  error?: string;
}

@Injectable()
export class DashboardService {
  private wechatAccessTokenCache: { token: string; expiresAt: number } | null = null;
  private wechatTlsCompatWarned = false;

  constructor(
    private readonly configService: ConfigService,
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
      wechatAnalytics,
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
      this.getWechatAnalytics(7),
    ]);

    const mergedTrend = this.mergeWechatTrend(trend, wechatAnalytics);

    return {
      totalUsers: wechatAnalytics.cumulativeUsers ?? totalUsers,
      todayUsers: wechatAnalytics.newUsers ?? todayUsers,
      todayViews: wechatAnalytics.visitPv ?? todayAnswerViews + todayFileViews,
      todayOpenCount: wechatAnalytics.openCount ?? 0,
      todayVisitors: wechatAnalytics.visitors ?? 0,
      todayOrders,
      monthOrders,
      todayRevenue,
      monthRevenue,
      totalRevenue,
      wechatAnalytics,
      // 保持旧字段兼容
      user_count: wechatAnalytics.cumulativeUsers ?? totalUsers,
      order_count: monthOrders,
      total_revenue: totalRevenue,
      trend: mergedTrend,
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

  private formatWechatDate(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private formatDisplayDate(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
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

  private mergeWechatTrend(
    businessTrend: Array<{ date: string; newUsers: number; views: number; orders: number; revenue: number }>,
    wechatAnalytics: WechatAnalytics,
  ) {
    if (!wechatAnalytics.enabled || !wechatAnalytics.trend?.length) {
      return businessTrend;
    }

    const wechatTrendMap = new Map(wechatAnalytics.trend.map((item) => [item.date, item]));
    return businessTrend.map((item) => {
      const wechatItem = wechatTrendMap.get(item.date);
      if (!wechatItem) {
        return item;
      }
      return {
        ...item,
        newUsers: wechatItem.newUsers,
        views: wechatItem.visitPv,
        openCount: wechatItem.openCount,
        visitors: wechatItem.visitors,
      };
    });
  }

  private async getWechatAnalytics(days: number): Promise<WechatAnalytics> {
    const appid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
    const secret =
      this.configService.get<string>('WECHAT_SECRET') ||
      this.configService.get<string>('WECHAT_APPSECRET') ||
      this.configService.get<string>('AppSecret');

    if (!appid || !secret) {
      return {
        enabled: false,
        source: 'business_fallback',
        error: '未配置 WECHAT_APPID 或 WECHAT_SECRET',
      };
    }

    try {
      const token = await this.getWechatAccessToken(appid, secret);
      const todayStart = this.getDayStart();
      const yesterday = this.addDays(todayStart, -1);
      const begin = this.addDays(yesterday, -(days - 1));
      const beginDate = this.formatWechatDate(begin);
      const endDate = this.formatWechatDate(yesterday);
      const yesterdayDate = this.formatWechatDate(yesterday);

      const [summaryRes, visitTrendRes] = await Promise.all([
        this.requestWechatPublicApi(
          `https://api.weixin.qq.com/datacube/getweanalysisappiddailysummarytrend?access_token=${token}`,
          { begin_date: yesterdayDate, end_date: yesterdayDate },
        ),
        this.requestWechatPublicApi(
          `https://api.weixin.qq.com/datacube/getweanalysisappiddailyvisittrend?access_token=${token}`,
          { begin_date: beginDate, end_date: endDate },
        ),
      ]);

      this.assertWechatDatacubeResponse(summaryRes.data, '微信概况数据');
      this.assertWechatDatacubeResponse(visitTrendRes.data, '微信访问趋势数据');

      const summaryList = Array.isArray(summaryRes.data?.list) ? summaryRes.data.list : [];
      const visitList = Array.isArray(visitTrendRes.data?.list) ? visitTrendRes.data.list : [];
      const summary = summaryList.find((item: any) => item.ref_date === yesterdayDate) || summaryList[0] || {};
      const yesterdayVisit = visitList.find((item: any) => item.ref_date === yesterdayDate) || visitList[visitList.length - 1] || {};
      const trend = visitList.map((item: any) => ({
        date: this.formatDateFromWechat(item.ref_date),
        openCount: Number(item.session_cnt || 0),
        visitPv: Number(item.visit_pv || 0),
        visitors: Number(item.visit_uv || 0),
        newUsers: Number(item.visit_uv_new || 0),
      }));

      return {
        enabled: true,
        source: 'wechat_datacube',
        date: this.formatDisplayDate(yesterday),
        cumulativeUsers: Number(summary.visit_total || 0),
        openCount: Number(yesterdayVisit.session_cnt || 0),
        visitPv: Number(yesterdayVisit.visit_pv || 0),
        visitors: Number(yesterdayVisit.visit_uv || 0),
        newUsers: Number(yesterdayVisit.visit_uv_new || 0),
        trend,
      };
    } catch (error: any) {
      console.warn('[微信数据分析] 拉取失败，使用业务库数据兜底:', error?.message || error);
      return {
        enabled: false,
        source: 'business_fallback',
        error: error?.message || '微信数据分析拉取失败',
      };
    }
  }

  private formatDateFromWechat(refDate: string) {
    if (!refDate || refDate.length !== 8) {
      return refDate || '';
    }
    return `${refDate.slice(4, 6)}-${refDate.slice(6, 8)}`;
  }

  private assertWechatDatacubeResponse(data: any, label: string) {
    if (data?.errcode) {
      throw new Error(`${label}拉取失败：${data.errmsg || data.errcode}`);
    }
  }

  private async getWechatAccessToken(appid: string, secret: string): Promise<string> {
    const now = Date.now();
    if (this.wechatAccessTokenCache && this.wechatAccessTokenCache.expiresAt > now + 60_000) {
      return this.wechatAccessTokenCache.token;
    }

    const response = await this.requestWechatPublicApi('https://api.weixin.qq.com/cgi-bin/token', null, {
      grant_type: 'client_credential',
      appid,
      secret,
    });
    const { access_token, expires_in, errcode, errmsg } = response.data || {};
    if (errcode || !access_token) {
      throw new Error(errmsg || `获取微信 access_token 失败 (${errcode || 'unknown'})`);
    }

    this.wechatAccessTokenCache = {
      token: access_token,
      expiresAt: now + Math.max(Number(expires_in || 7200) - 300, 60) * 1000,
    };
    return access_token;
  }

  private async requestWechatPublicApi(url: string, data?: Record<string, any> | null, params?: Record<string, any>) {
    try {
      if (data) {
        return await axios.post(url, data, { params, timeout: 10000 });
      }
      return await axios.get(url, { params, timeout: 10000 });
    } catch (error: any) {
      if (!this.isTlsCertificateError(error)) {
        throw error;
      }

      if (!this.wechatTlsCompatWarned) {
        this.wechatTlsCompatWarned = true;
        console.warn('[微信公网接口] TLS 证书校验失败，使用兼容模式重试:', error.message);
      }
      const requestConfig = {
        params,
        timeout: 10000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      };
      if (data) {
        return axios.post(url, data, requestConfig);
      }
      return axios.get(url, requestConfig);
    }
  }

  private isTlsCertificateError(error: any): boolean {
    const code = error?.code || error?.cause?.code;
    const message = String(error?.message || error?.cause?.message || '').toLowerCase();
    return (
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      message.includes('self-signed certificate') ||
      message.includes('unable to verify the first certificate')
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
