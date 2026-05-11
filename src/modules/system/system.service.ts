import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SysOperationLog } from '../../database/entities/sys-operation-log.entity';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { SetCountdownDto } from './dto/set-countdown.dto';
import { SetDailyQuotesDto } from './dto/set-daily-quotes.dto';
import { GetOperationLogsDto } from './dto/get-operation-logs.dto';
import { SetCourseCoverConfigDto } from './dto/set-course-cover-config.dto';

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

  private async getJsonConfig<T>(configKey: string, fallback: T): Promise<T> {
    const config = await this.systemConfigRepository.findOne({ where: { configKey } });
    if (config?.configValue) {
      try {
        return JSON.parse(config.configValue) as T;
      } catch (error) {
        console.error(`解析系统配置失败: ${configKey}`, error);
      }
    }
    return fallback;
  }

  private async setJsonConfig(configKey: string, description: string, value: unknown) {
    let config = await this.systemConfigRepository.findOne({ where: { configKey } });
    if (!config) {
      config = this.systemConfigRepository.create({
        configKey,
        configValue: JSON.stringify(value),
        description,
      });
    } else {
      config.configValue = JSON.stringify(value);
      config.description = description;
      config.updateTime = new Date();
    }
    await this.systemConfigRepository.save(config);
  }

  private getDefaultCourseCoverConfig() {
    return {
      width: 1200,
      height: 1200,
      backgroundImage: '',
      backgroundColor: '#5d9ef0',
      fields: [
        {
          id: 'top_title',
          label: '顶部标题',
          type: 'staticText',
          text: '赠送公共课数学英语政治历年真题及资料',
          x: 600,
          y: 96,
          fontSize: 56,
          color: '#F9F4DF',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 1140,
          align: 'center',
          maxLines: 1,
          lineHeight: 56,
        },
        {
          id: 'school',
          label: '学校',
          type: 'courseField',
          sourceKey: 'school',
          x: 600,
          y: 325,
          fontSize: 108,
          color: '#58A7F7',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 940,
          align: 'center',
          maxLines: 1,
          lineHeight: 108,
        },
        {
          id: 'major',
          label: '专业',
          type: 'courseField',
          sourceKey: 'major',
          x: 600,
          y: 515,
          fontSize: 62,
          color: '#FDF8ED',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 1080,
          align: 'center',
          maxLines: 1,
          lineHeight: 62,
        },
        {
          id: 'store_text',
          label: '店铺文案',
          type: 'staticText',
          text: '下一站上岸书店',
          x: 600,
          y: 745,
          fontSize: 58,
          color: '#f3ea53',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 900,
          align: 'center',
          maxLines: 1,
          lineHeight: 58,
        },
        {
          id: 'exam_year',
          label: '真题年份',
          type: 'courseField',
          sourceKey: 'exam_year',
          x: 360,
          y: 840,
          fontSize: 42,
          color: '#FFFFFF',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 460,
          align: 'left',
          maxLines: 1,
          lineHeight: 42,
        },
        {
          id: 'answer_year',
          label: '答案年份',
          type: 'courseField',
          sourceKey: 'answer_year',
          x: 360,
          y: 915,
          fontSize: 42,
          color: '#FFFFFF',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 460,
          align: 'left',
          maxLines: 1,
          lineHeight: 42,
        },
        {
          id: 'delivery_text',
          label: '底部主文案',
          type: 'staticText',
          text: '网盘电子版  速发',
          x: 600,
          y: 1075,
          fontSize: 76,
          color: '#58A7F7',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 980,
          align: 'center',
          maxLines: 1,
          lineHeight: 76,
        },
        {
          id: 'bottom_caption',
          label: '底部说明',
          type: 'staticText',
          text: '全网最新考研(学长学姐自用资料)',
          x: 600,
          y: 1180,
          fontSize: 52,
          color: '#FDF9EE',
          backgroundColor: 'transparent',
          fontWeight: '700',
          fontFamily: 'serif',
          maxWidth: 1140,
          align: 'center',
          maxLines: 1,
          lineHeight: 52,
        },
      ],
    };
  }

  async getCourseCoverConfig() {
    return this.getJsonConfig('course_cover_config', this.getDefaultCourseCoverConfig());
  }

  async setCourseCoverConfig(dto: SetCourseCoverConfigDto) {
    await this.setJsonConfig('course_cover_config', '课程自动生成封面配置', dto);
    return {
      success: true,
      message: '课程封面配置已更新',
      config: dto,
    };
  }

  private getDefaultCourseIntroTemplate() {
    return [
      '<h3>课程介绍</h3>',
      '<p>本课程包含系统整理的复习资料与配套练习内容，适合用于日常复习、考前冲刺和查漏补缺。</p>',
      '<p>购买或激活后，可在小程序内查看课程内容，并根据课程类型进行在线练习或文件学习。</p>',
    ].join('');
  }

  async getCourseIntroTemplate() {
    return this.getJsonConfig('course_intro_template', this.getDefaultCourseIntroTemplate());
  }

  async setCourseIntroTemplate(template: string) {
    const safeTemplate = String(template || '').trim();
    await this.setJsonConfig('course_intro_template', '课程介绍默认模板', safeTemplate);
    return {
      success: true,
      template: safeTemplate,
    };
  }

  async getFaqConfig() {
    return this.getJsonConfig('faq_config', [
      {
        question: '激活码如何使用？',
        answer: '在首页快捷入口或“我的-使用激活码”中输入激活码，激活成功后即可解锁对应课程。',
      },
      {
        question: '购买后在哪里查看课程？',
        answer: '购买或激活成功后，可在“练习”页面切换并查看已解锁课程。',
      },
    ]);
  }

  async setFaqConfig(items: Array<{ question: string; answer: string }>) {
    const safeItems = (Array.isArray(items) ? items : [])
      .map((item) => ({
        question: String(item?.question || '').trim(),
        answer: String(item?.answer || '').trim(),
      }))
      .filter((item) => item.question && item.answer);
    await this.setJsonConfig('faq_config', '小程序常见问题配置', safeItems);
    return {
      success: true,
      items: safeItems,
    };
  }

  /**
   * 获取操作日志列表（支持搜索和筛选）
   */
  async getOperationLogs(dto: GetOperationLogsDto) {
    const {
      page = 1,
      pageSize = 20,
      keyword,
      module,
      action,
      adminId,
      adminUsername,
      userType,
      startTime,
      endTime,
    } = dto;

    const queryBuilder = this.operationLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.admin', 'admin')
      .leftJoinAndSelect('admin.roleEntity', 'role')
      .orderBy('log.create_time', 'DESC');

    // 搜索关键词（模块、操作、管理员用户名）
    if (keyword) {
      queryBuilder.andWhere(
        '(log.module LIKE :keyword OR log.action LIKE :keyword OR admin.username LIKE :keyword)',
        { keyword: `%${keyword}%` }
      );
    }

    // 筛选模块
    if (module) {
      queryBuilder.andWhere('log.module = :module', { module });
    }

    // 筛选操作类型
    if (action) {
      queryBuilder.andWhere('log.action = :action', { action });
    }

    // 筛选管理员ID
    if (adminId) {
      queryBuilder.andWhere('log.admin_id = :adminId', { adminId });
    }

    // 筛选操作人用户名
    if (adminUsername) {
      queryBuilder.andWhere('admin.username LIKE :adminUsername', {
        adminUsername: `%${adminUsername}%`,
      });
    }

    // 筛选操作用户类型（角色名称）
    if (userType) {
      queryBuilder.andWhere('role.name = :userType', { userType });
    }

    // 筛选时间范围
    if (startTime) {
      queryBuilder.andWhere('log.create_time >= :startTime', { startTime });
    }
    if (endTime) {
      queryBuilder.andWhere('log.create_time <= :endTime', { endTime });
    }

    // 分页
    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [logs, total] = await queryBuilder.getManyAndCount();

    // 格式化返回数据
    const list = logs.map((log) => {
      // 获取用户类型：优先使用角色实体名称，如果没有则使用枚举值
      let userType = '未知';
      if (log.admin?.roleEntity?.name) {
        userType = log.admin.roleEntity.name;
      } else if (log.admin?.role) {
        // 映射枚举值到中文名称
        const roleMap: Record<string, string> = {
          super_admin: '系统管理员',
          content_admin: '题库管理员',
          agent: '代理商',
        };
        userType = roleMap[log.admin.role] || log.admin.role;
      }

      return {
        id: log.id,
        adminId: log.admin_id,
        adminUsername: log.admin?.username || '未知',
        userType: userType,
        module: log.module,
        action: log.action,
        targetId: log.target_id,
        content: log.content,
        ip: log.ip,
        createTime: log.create_time,
      };
    });

    return {
      list,
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

  /**
   * 获取打卡时间配置（分钟）
   */
  async getCheckinMinutes(): Promise<number> {
    const config = await this.systemConfigRepository.findOne({
      where: { configKey: 'checkin_minutes' },
    });

    if (config && config.configValue) {
      try {
        const minutes = parseInt(config.configValue, 10);
        if (!isNaN(minutes) && minutes > 0) {
          return minutes;
        }
      } catch (e) {
        console.error('解析打卡时间配置失败:', e);
      }
    }

    // 默认30分钟
    return 30;
  }

  /**
   * 设置打卡时间配置（分钟）
   */
  async setCheckinMinutes(minutes: number) {
    if (!minutes || minutes <= 0) {
      throw new Error('打卡时间必须大于0');
    }

    let config = await this.systemConfigRepository.findOne({
      where: { configKey: 'checkin_minutes' },
    });

    if (!config) {
      config = this.systemConfigRepository.create({
        configKey: 'checkin_minutes',
        configValue: minutes.toString(),
        description: '刷题打卡所需时间（分钟）',
      });
    } else {
      config.configValue = minutes.toString();
      config.updateTime = new Date();
    }

    await this.systemConfigRepository.save(config);

    return {
      success: true,
      message: '打卡时间配置已更新',
      minutes,
    };
  }
}
