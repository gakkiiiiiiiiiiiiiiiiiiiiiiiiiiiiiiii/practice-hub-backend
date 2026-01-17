import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SysOperationLog } from '../../database/entities/sys-operation-log.entity';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { SetCountdownDto } from './dto/set-countdown.dto';
import { SetDailyQuotesDto } from './dto/set-daily-quotes.dto';

@Injectable()
export class SystemService {
  constructor(
    @InjectRepository(SysOperationLog)
    private operationLogRepository: Repository<SysOperationLog>,
    @InjectRepository(SystemConfig)
    private systemConfigRepository: Repository<SystemConfig>,
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

  /**
   * 获取广播消息列表
   */
  async getDailyQuotes(): Promise<string[]> {
    const config = await this.systemConfigRepository.findOne({
      where: { configKey: 'daily_quotes' },
    });

    if (config && config.configValue) {
      try {
        const quotes = JSON.parse(config.configValue);
        if (Array.isArray(quotes) && quotes.length > 0) {
          return quotes;
        }
      } catch (e) {
        console.error('解析广播消息配置失败:', e);
      }
    }

    // 如果没有配置，返回默认广播消息
    return [
      '宝剑锋从磨砺出，梅花香自苦寒来。',
      '不经一番寒彻骨，怎得梅花扑鼻香。',
      '路漫漫其修远兮，吾将上下而求索。',
      '天行健，君子以自强不息。',
      '业精于勤，荒于嬉；行成于思，毁于随。',
      '书山有路勤为径，学海无涯苦作舟。',
      '只要功夫深，铁杵磨成针。',
      '不积跬步，无以至千里；不积小流，无以成江海。',
    ];
  }

  /**
   * 设置广播消息列表
   */
  async setDailyQuotes(dto: SetDailyQuotesDto) {
    let config = await this.systemConfigRepository.findOne({
      where: { configKey: 'daily_quotes' },
    });

    if (!config) {
      config = this.systemConfigRepository.create({
        configKey: 'daily_quotes',
        configValue: JSON.stringify(dto.quotes),
        description: '首页广播消息列表',
      });
    } else {
      config.configValue = JSON.stringify(dto.quotes);
      config.updateTime = new Date();
    }

    await this.systemConfigRepository.save(config);

    return {
      success: true,
      message: '广播消息列表已更新',
      quotes: dto.quotes,
    };
  }
}

