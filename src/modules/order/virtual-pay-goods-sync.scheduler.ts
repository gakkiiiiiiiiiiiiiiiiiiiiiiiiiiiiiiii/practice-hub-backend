import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VirtualPayGoodsService } from './virtual-pay-goods.service';

@Injectable()
export class VirtualPayGoodsSyncScheduler {
  private readonly logger = new Logger(VirtualPayGoodsSyncScheduler.name);
  private running = false;

  constructor(private readonly virtualPayGoodsService: VirtualPayGoodsService) {}

  /** 每日自动全量同步课程与套餐虚拟道具价格 */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleDailySync() {
    if (!this.virtualPayGoodsService.isScheduledSyncEnabled()) {
      return;
    }
    if (this.running) {
      this.logger.warn('虚拟道具定时同步仍在执行，跳过本次任务');
      return;
    }

    this.running = true;
    try {
      const counts = await this.virtualPayGoodsService.countVirtualPaySyncTargets();
      this.logger.log(
        `开始定时虚拟道具同步：${counts.courses} 门课程、${counts.packages} 个套餐规格`,
      );
      await this.virtualPayGoodsService.syncAllGoods({ force: true });
      this.logger.log('定时虚拟道具同步完成');
    } catch (error: any) {
      this.logger.warn(`定时虚拟道具同步失败: ${error?.message || error}`);
    } finally {
      this.running = false;
    }
  }
}
