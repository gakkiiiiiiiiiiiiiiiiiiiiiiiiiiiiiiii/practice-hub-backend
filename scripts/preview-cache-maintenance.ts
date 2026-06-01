/**
 * 预览缓存定时巡检脚本（可配合 crontab / Docker 定时任务）
 *
 * 用法：
 *   npm run preview-cache:maintenance
 *   npm run preview-cache:maintenance -- --report-only
 *
 * 环境变量（与后端 .env 相同）：
 *   PREVIEW_CACHE_MAINTENANCE_ENABLED=true
 *   PREVIEW_CACHE_MAINTENANCE_COOLDOWN_HOURS=2
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PreviewCacheMaintenanceService } from '../src/modules/admin-course/preview-cache-maintenance.service';
import { AdminCourseService } from '../src/modules/admin-course/admin-course.service';

async function main() {
  const reportOnly = process.argv.includes('--report-only');
  const enabled = process.env.PREVIEW_CACHE_MAINTENANCE_ENABLED ?? 'true';
  if (enabled === 'false' || enabled === '0') {
    console.log('[preview-cache-maintenance] 已禁用（PREVIEW_CACHE_MAINTENANCE_ENABLED=false）');
    process.exit(0);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const adminCourseService = app.get(AdminCourseService);

    if (reportOnly) {
      const report = await adminCourseService.getPreviewCacheHealthReport();
      console.log('[preview-cache-maintenance] 健康报告:');
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.issueCount > 0 ? 2 : 0);
    }

    const maintenanceService = app.get(PreviewCacheMaintenanceService);
    const result = await maintenanceService.runMaintenance('script');
    console.log('[preview-cache-maintenance] 执行结果:');
    console.log(JSON.stringify(result, null, 2));

    const exitCode = result.action === 'skipped' ? 0 : result.action === 'none' ? 0 : 0;
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[preview-cache-maintenance] 失败:', message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

void main();
