import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AdminCourseService } from './admin-course.service';

@Injectable()
export class PreviewCacheMaintenanceService {
  private readonly logger = new Logger(PreviewCacheMaintenanceService.name);
  private running = false;

  constructor(
    private readonly adminCourseService: AdminCourseService,
    private readonly configService: ConfigService,
  ) {}

  /** 默认每天凌晨 3 点巡检，可通过 PREVIEW_CACHE_MAINTENANCE_CRON 覆盖 */
  @Cron(process.env.PREVIEW_CACHE_MAINTENANCE_CRON || CronExpression.EVERY_DAY_AT_3AM)
  async handleScheduledMaintenance() {
    const enabled = this.configService.get<string>('PREVIEW_CACHE_MAINTENANCE_ENABLED', 'true');
    if (enabled === 'false' || enabled === '0') {
      return;
    }
    await this.runMaintenance('cron');
  }

  async runMaintenance(source = 'manual') {
    if (this.running) {
      this.logger.warn(`预览缓存巡检跳过：上一次 ${source} 任务仍在执行`);
      return { action: 'skipped', reason: 'maintenance_running' };
    }

    this.running = true;
    try {
      this.logger.log(`预览缓存巡检开始 source=${source}`);
      const result = await this.adminCourseService.runScheduledPreviewCacheMaintenance();
      this.logger.log(`预览缓存巡检结束 action=${result.action}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`预览缓存巡检失败: ${message}`);
      throw error;
    } finally {
      this.running = false;
    }
  }
}
