import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order } from '../../database/entities/order.entity';
import { normalizePayAmountYuan } from '../../common/utils/price.util';
import { XpayService } from './xpay.service';

export type CoinPurchasePayload = {
  coin_cost: number;
  balance_applied: number;
  recharge_coins: number;
  recharge_order_no?: string;
  currency_pay_order_id?: string;
  recharge_settled?: boolean;
  currency_paid?: boolean;
};

@Injectable()
export class CoinService {
  private readonly logger = new Logger(CoinService.name);
  private readonly wechatBalanceCache = new Map<number, { balance: number; at: number }>();
  private static readonly WECHAT_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly xpayService: XpayService,
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
  ) {}

  /** 1 元人民币对应微信代币数（与小程序后台一致，默认 1 元 = 1 代币） */
  getCoinPerYuan() {
    const value = Number(this.configService.get<string>('WECHAT_COIN_PER_YUAN') ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  /** 支付金额（元）→ 微信代币整数 */
  yuanToCoinInt(yuan: number) {
    const amount = normalizePayAmountYuan(Number(yuan || 0));
    if (amount <= 0) {
      return 1;
    }
    return Math.max(1, Math.round(amount * this.getCoinPerYuan()));
  }

  getDefaultUserIp(clientIp?: string) {
    const ip = String(clientIp || this.configService.get<string>('WECHAT_PAY_SPBILL_CREATE_IP') || '127.0.0.1').trim();
    return ip || '127.0.0.1';
  }

  buildCoinPurchasePlan(coinCost: number, currentBalance: number): CoinPurchasePayload {
    const normalizedCost = Math.max(1, Math.floor(Number(coinCost || 0)));
    const balance = Math.max(0, Math.floor(Number(currentBalance || 0)));
    const balanceApplied = Math.min(balance, normalizedCost);
    const rechargeCoins = Math.max(0, normalizedCost - balanceApplied);
    return {
      coin_cost: normalizedCost,
      balance_applied: balanceApplied,
      recharge_coins: rechargeCoins,
    };
  }

  async resolveBalanceForOrder(user: AppUser, clientIp?: string) {
    try {
      const balance = await this.queryWechatBalance(user, clientIp);
      return { balance, fromCache: false };
    } catch (error) {
      const cached = this.getCachedWechatBalance(user.id) ?? Math.max(0, Math.floor(Number(user.coin_balance || 0)));
      this.logger.warn(`query_user_balance 失败，使用缓存余额 ${cached}: ${error?.message || error}`);
      return { balance: cached, fromCache: true };
    }
  }

  async queryWechatBalance(user: AppUser, clientIp?: string) {
    if (!user.session_key) {
      throw new BadRequestException('登录态已过期，请重新登录后再试');
    }
    const config = this.xpayService.getVirtualPayConfig();
    const userIp = this.getDefaultUserIp(clientIp);
    const result = await this.xpayService.callXpayApi(
      '/xpay/query_user_balance',
      {
        openid: user.openid,
        user_ip: userIp,
        env: config.env,
      },
      { sessionKey: user.session_key },
    );
    if (result.errcode && !this.xpayService.isXpayDuplicateSuccess(Number(result.errcode))) {
      throw new BadRequestException(result.errmsg || `查询微信代币余额失败(${result.errcode})`);
    }
    const balance = Math.max(0, Math.floor(Number(result.balance || 0)));
    await this.cacheWechatBalance(user.id, balance);
    return balance;
  }

  async getBalance(userId: number, clientIp?: string) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('用户不存在');
    }
    try {
      return await this.queryWechatBalance(user, clientIp);
    } catch (error) {
      this.logger.warn(`查询微信代币余额失败，使用本地缓存: ${error?.message || error}`);
      return this.getCachedWechatBalance(userId) ?? Math.max(0, Math.floor(Number(user.coin_balance || 0)));
    }
  }

  private getCachedWechatBalance(userId: number) {
    const cached = this.wechatBalanceCache.get(userId);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.at > CoinService.WECHAT_CACHE_TTL_MS) {
      this.wechatBalanceCache.delete(userId);
      return null;
    }
    return cached.balance;
  }

  private setCachedWechatBalance(userId: number, balance: number) {
    this.wechatBalanceCache.set(userId, { balance, at: Date.now() });
  }

  private async cacheWechatBalance(userId: number, balance: number) {
    this.setCachedWechatBalance(userId, balance);
    await this.appUserRepository.update({ id: userId }, { coin_balance: balance });
  }

  async isRechargeOrderPaid(user: AppUser, rechargeOrderNo: string) {
    const config = this.xpayService.getVirtualPayConfig();
    const result = await this.xpayService.callXpayApi('/xpay/query_order', {
      openid: user.openid,
      order_id: rechargeOrderNo,
      env: config.env,
    });
    if (result.errcode) {
      this.logger.warn(`查询充值单 ${rechargeOrderNo} 失败: ${result.errmsg || result.errcode}`);
      return false;
    }
    const status = Number(result.order?.status ?? 0);
    return status >= 2;
  }

  async waitForRechargeSettled(user: AppUser, rechargeOrderNo: string, coinCost: number, clientIp?: string) {
    const maxAttempts = Math.max(1, Number(this.configService.get<string>('WECHAT_COIN_RECHARGE_QUERY_ATTEMPTS') || 5));
    const intervalMs = Math.max(500, Number(this.configService.get<string>('WECHAT_COIN_RECHARGE_QUERY_INTERVAL_MS') || 1500));
    const cost = Math.max(1, Math.floor(Number(coinCost || 0)));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const paid = await this.isRechargeOrderPaid(user, rechargeOrderNo);
      let balance = 0;
      try {
        balance = await this.queryWechatBalance(user, clientIp);
      } catch (error) {
        this.logger.warn(`轮询充值结果时查询余额失败: ${error?.message || error}`);
        balance = this.getCachedWechatBalance(user.id) ?? Math.max(0, Math.floor(Number(user.coin_balance || 0)));
      }
      if (paid && balance >= cost) {
        return true;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return false;
  }

  async currencyPayForOrder(params: {
    user: AppUser;
    order: Order;
    coinAmount: number;
    clientIp?: string;
    currencyPayOrderId?: string;
    /** 服务端对账场景可跳过用户 session 签名 */
    allowMissingSessionKey?: boolean;
  }) {
    const { user, order, clientIp } = params;
    const coinAmount = Math.max(1, Math.floor(Number(params.coinAmount || 0)));
    if (!user.session_key && !params.allowMissingSessionKey) {
      throw new BadRequestException('登录态已过期，请重新登录后再试');
    }

    const currencyPayOrderId = params.currencyPayOrderId || `${order.order_no}_COIN`;
    const config = this.xpayService.getVirtualPayConfig();
    const userIp = this.getDefaultUserIp(clientIp);
    const payYuan = normalizePayAmountYuan(Number(order.original_amount || order.amount || 0));
    const unitPriceCents = Math.max(1, payYuan * 100);
    const productId =
      order.order_type === 'package'
        ? `package_${order.package_plan_id || 0}`
        : order.course_id
          ? `course_${order.course_id}`
          : 'course';
    const payitem = JSON.stringify([
      {
        productid: productId,
        unit_price: unitPriceCents,
        quantity: 1,
      },
    ]);

    const result = await this.xpayService.callXpayApi(
      '/xpay/currency_pay',
      {
        openid: user.openid,
        user_ip: userIp,
        env: config.env,
        amount: coinAmount,
        order_id: currencyPayOrderId,
        payitem,
        remark: order.order_type === 'package' ? '购买套餐' : '购买课程',
      },
      user.session_key ? { sessionKey: user.session_key } : undefined,
    );

    const errcode = Number(result.errcode || 0);
    if (errcode && !this.xpayService.isXpayDuplicateSuccess(errcode)) {
      throw new BadRequestException(result.errmsg || `微信代币扣减失败(${errcode})`);
    }

    const balance = Math.max(0, Math.floor(Number(result.balance || 0)));
    await this.cacheWechatBalance(user.id, balance);

    return {
      currencyPayOrderId,
      balance,
      result,
    };
  }

  async cancelCurrencyPayForOrder(params: {
    user: AppUser;
    payOrderId: string;
    refundOrderId: string;
    coinAmount: number;
    clientIp?: string;
    allowMissingSessionKey?: boolean;
  }) {
    const { user, clientIp } = params;
    const coinAmount = Math.max(1, Math.floor(Number(params.coinAmount || 0)));
    if (!user.session_key && !params.allowMissingSessionKey) {
      throw new BadRequestException('用户登录态已过期，请让用户重新登录小程序后再退款');
    }

    const config = this.xpayService.getVirtualPayConfig();
    const userIp = this.getDefaultUserIp(clientIp);
    const result = await this.xpayService.callXpayApi(
      '/xpay/cancel_currency_pay',
      {
        openid: user.openid,
        env: config.env,
        user_ip: userIp,
        pay_order_id: params.payOrderId,
        order_id: params.refundOrderId,
        amount: coinAmount,
      },
      user.session_key ? { sessionKey: user.session_key } : undefined,
    );

    const errcode = Number(result.errcode || 0);
    if (errcode && !this.xpayService.isXpayDuplicateSuccess(errcode)) {
      throw new BadRequestException(result.errmsg || `微信代币退款失败(${errcode})`);
    }

    const balance = Math.max(0, Math.floor(Number(result.balance || 0)));
    await this.cacheWechatBalance(user.id, balance);

    return result;
  }

  async refundCashRechargeOrder(params: {
    user: AppUser;
    rechargeOrderNo: string;
    refundOrderId: string;
    refundFeeCents: number;
    clientIp?: string;
    remark?: string;
  }) {
    const refundFeeCents = Math.max(1, Math.floor(Number(params.refundFeeCents || 0)));
    const config = this.xpayService.getVirtualPayConfig();
    const queryResult = await this.xpayService.callXpayApi('/xpay/query_order', {
      openid: params.user.openid,
      order_id: params.rechargeOrderNo,
      env: config.env,
    });
    const leftFee = Math.max(
      refundFeeCents,
      Math.floor(Number(queryResult.order?.left_fee ?? queryResult.order?.leftFee ?? refundFeeCents)),
    );

    const result = await this.xpayService.callXpayApi('/xpay/refund_order', {
      openid: params.user.openid,
      order_id: params.rechargeOrderNo,
      refund_order_id: params.refundOrderId,
      left_fee: leftFee,
      refund_fee: Math.min(refundFeeCents, leftFee),
      biz_meta: JSON.stringify({
        order_no: params.rechargeOrderNo,
        remark: params.remark || '售后退款',
      }),
      refund_reason: '1',
      req_from: '1',
      env: config.env,
    });

    const errcode = Number(result.errcode || 0);
    if (errcode && !this.xpayService.isXpayDuplicateSuccess(errcode)) {
      throw new BadRequestException(result.errmsg || `微信现金退款失败(${errcode})`);
    }

    return result;
  }
}
