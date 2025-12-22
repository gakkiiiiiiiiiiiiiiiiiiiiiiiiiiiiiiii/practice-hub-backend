import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SysOperationLog } from '../../database/entities/sys-operation-log.entity';
import { RedisService } from '../../common/redis/redis.service';
import { SetCountdownDto } from './dto/set-countdown.dto';

@Injectable()
export class SystemService {
  constructor(
    @InjectRepository(SysOperationLog)
    private operationLogRepository: Repository<SysOperationLog>,
    private redisService: RedisService,
    private configService: ConfigService,
  ) {}

  /**
   * 设置考研倒计时
   */
  async setCountdown(dto: SetCountdownDto) {
    // 保存到 Redis 或数据库
    await this.redisService.set('countdown_date', dto.date);
    return { success: true };
  }

  /**
   * 获取操作日志列表
   */
  async getOperationLogs(page = 1, pageSize = 20) {
    const [logs, total] = await this.operationLogRepository.findAndCount({
      order: { create_time: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      list: logs,
      total,
      page,
      pageSize,
    };
  }
}

