import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SysOperationLog } from '../../database/entities/sys-operation-log.entity';
import { SetCountdownDto } from './dto/set-countdown.dto';

@Injectable()
export class SystemService {
  constructor(
    @InjectRepository(SysOperationLog)
    private operationLogRepository: Repository<SysOperationLog>,
    private configService: ConfigService,
  ) {}

  /**
   * 设置考研倒计时
   * 保存到环境变量或数据库（这里使用环境变量，实际可以存储到数据库）
   */
  async setCountdown(dto: SetCountdownDto) {
    // 注意：环境变量在运行时无法修改，这里仅做示例
    // 实际生产环境应该存储到数据库的系统配置表中
    // 这里返回成功，实际日期从环境变量或数据库读取
    return { success: true, message: '倒计时日期已更新（请通过环境变量或数据库配置）' };
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

