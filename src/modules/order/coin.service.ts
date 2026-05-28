import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { CoinTransaction, CoinTransactionType } from '../../database/entities/coin-transaction.entity';
import { Order } from '../../database/entities/order.entity';

export type CoinPurchasePayload = {
  coin_cost: number;
  balance_applied: number;
  recharge_amount: number;
  settled?: boolean;
};

@Injectable()
export class CoinService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
    @InjectRepository(CoinTransaction)
    private readonly coinTransactionRepository: Repository<CoinTransaction>,
  ) {}

  /** 1 元人民币兑换代币数量，默认 1:1 */
  getCoinPerYuan() {
    const value = Number(this.configService.get<string>('COIN_PER_YUAN') ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  yuanToCoin(yuan: number) {
    return Number((Number(yuan || 0) * this.getCoinPerYuan()).toFixed(2));
  }

  async getBalance(userId: number) {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('用户不存在');
    }
    return Number(user.coin_balance || 0);
  }

  buildCoinPurchasePlan(coinCost: number, currentBalance: number): CoinPurchasePayload {
    const coinPerYuan = this.getCoinPerYuan();
    const normalizedCost = Number(Number(coinCost || 0).toFixed(2));
    const balance = Number(Number(currentBalance || 0).toFixed(2));
    const balanceApplied = Math.min(balance, normalizedCost);
    const coinShortfall = Math.max(0, Number((normalizedCost - balanceApplied).toFixed(2)));
    const rechargeAmount = Number((coinShortfall / coinPerYuan).toFixed(2));
    return {
      coin_cost: normalizedCost,
      balance_applied: balanceApplied,
      recharge_amount: rechargeAmount,
    };
  }

  async deductForPurchase(userId: number, coinAmount: number, orderId: number, remark?: string) {
    const amount = Number(Number(coinAmount || 0).toFixed(2));
    if (amount <= 0) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      const balance = Number(user.coin_balance || 0);
      if (balance < amount) {
        throw new BadRequestException('代币余额不足');
      }
      user.coin_balance = Number((balance - amount).toFixed(2));
      await manager.save(user);
      await this.createTransaction(manager, {
        userId,
        type: CoinTransactionType.PURCHASE,
        amount: -amount,
        balanceAfter: Number(user.coin_balance),
        orderId,
        remark: remark || '购买课程/套餐',
      });
    });
  }

  /**
   * 微信充值确认后：入账充值金额，再扣减购课所需全部代币。
   */
  async settleRechargeAndPurchase(userId: number, order: Order, coinPurchase: CoinPurchasePayload) {
    if (coinPurchase.settled) {
      return;
    }

    const rechargeAmount = Number(Number(order.amount || 0).toFixed(2));
    const coinCost = Number(Number(coinPurchase.coin_cost || 0).toFixed(2));
    if (coinCost <= 0) {
      throw new BadRequestException('代币订单信息无效');
    }

    await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      let balance = Number(user.coin_balance || 0);

      if (rechargeAmount > 0) {
        const rechargeCoins = this.yuanToCoin(rechargeAmount);
        balance = Number((balance + rechargeCoins).toFixed(2));
        await this.createTransaction(manager, {
          userId,
          type: CoinTransactionType.RECHARGE,
          amount: rechargeCoins,
          balanceAfter: balance,
          orderId: order.id,
          remark: '微信充值代币',
        });
      }

      if (balance < coinCost) {
        throw new BadRequestException('代币结算失败，余额不足');
      }

      balance = Number((balance - coinCost).toFixed(2));
      user.coin_balance = balance;
      await manager.save(user);
      await this.createTransaction(manager, {
        userId,
        type: CoinTransactionType.PURCHASE,
        amount: -coinCost,
        balanceAfter: balance,
        orderId: order.id,
        remark: '充值后购买课程/套餐',
      });
    });
  }

  private async lockUser(manager: EntityManager, userId: number) {
    const user = await manager.findOne(AppUser, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) {
      throw new BadRequestException('用户不存在');
    }
    return user;
  }

  private async createTransaction(
    manager: EntityManager,
    params: {
      userId: number;
      type: CoinTransactionType;
      amount: number;
      balanceAfter: number;
      orderId?: number | null;
      remark?: string;
    },
  ) {
    const tx = manager.create(CoinTransaction, {
      user_id: params.userId,
      type: params.type,
      amount: params.amount,
      balance_after: params.balanceAfter,
      order_id: params.orderId ?? null,
      remark: params.remark ?? null,
    });
    await manager.save(tx);
  }
}
