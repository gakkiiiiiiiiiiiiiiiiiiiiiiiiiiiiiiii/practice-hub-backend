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
import { ceilIntegerYuanPrice } from '../../common/utils/price.util';

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

  private getDefaultCategoryCoverConfig() {
    return {
      width: 1200,
      height: 1200,
      backgroundImage: '',
      backgroundColor: '#F4F7FB',
      fields: [
        {
          id: 'category',
          label: '一级分类',
          type: 'courseField',
          sourceKey: 'category',
          x: 600,
          y: 460,
          fontSize: 112,
          color: '#8A9AB3',
          backgroundColor: 'transparent',
          fontWeight: '800',
          fontFamily: 'serif',
          maxWidth: 920,
          align: 'center',
          maxLines: 1,
          lineHeight: 122,
        },
        {
          id: 'sub_category',
          label: '二级分类',
          type: 'courseField',
          sourceKey: 'sub_category',
          x: 600,
          y: 735,
          fontSize: 148,
          color: '#6F7F99',
          backgroundColor: 'transparent',
          fontWeight: '900',
          fontFamily: 'serif',
          maxWidth: 980,
          align: 'center',
          maxLines: 1,
          lineHeight: 158,
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

  async getCategoryCoverConfig() {
    return this.getJsonConfig('category_cover_config', this.getDefaultCategoryCoverConfig());
  }

  async setCategoryCoverConfig(dto: SetCourseCoverConfigDto) {
    await this.setJsonConfig('category_cover_config', '分类自动生成封面配置', dto);
    return {
      success: true,
      message: '分类封面配置已更新',
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

  private getDefaultCourseDefaultParams() {
    return {
      subject: '',
      school: '',
      major: '',
      exam_year: '',
      answer_year: '',
      price: 1,
      agent_price: 1,
      is_free: 0,
      validity_days: 365,
      allow_source_file: 0,
      content_type: 'normal',
      status: 0,
    };
  }

  private normalizeCourseDefaultParams(input?: Record<string, any> | null) {
    const fallback = this.getDefaultCourseDefaultParams();
    const source = input || {};
    const isFree = Number(source.is_free ?? fallback.is_free) === 1 ? 1 : 0;
    const contentType = ['normal', 'file', 'paper_exam'].includes(source.content_type)
      ? source.content_type
      : 'normal';
    return {
      subject: String(source.subject || '').trim(),
      school: String(source.school || '').trim(),
      major: String(source.major || '').trim(),
      exam_year: String(source.exam_year || '').trim(),
      answer_year: String(source.answer_year || '').trim(),
      price: Math.max(0, ceilIntegerYuanPrice(Number(source.price ?? fallback.price) || 0)),
      agent_price: Math.max(0, ceilIntegerYuanPrice(Number(source.agent_price ?? fallback.agent_price) || 0)),
      is_free: isFree,
      validity_days:
        isFree === 1 ? null : Math.max(1, Number(source.validity_days ?? fallback.validity_days) || 365),
      allow_source_file: Number(source.allow_source_file ?? fallback.allow_source_file) === 1 ? 1 : 0,
      content_type: contentType,
      status: Number(source.status ?? fallback.status) === 1 ? 1 : 0,
    };
  }

  async getCourseDefaultParams() {
    const value = await this.getJsonConfig('course_default_params', this.getDefaultCourseDefaultParams());
    return this.normalizeCourseDefaultParams(value as Record<string, any>);
  }

  async setCourseDefaultParams(input: Record<string, any>) {
    const normalized = this.normalizeCourseDefaultParams(input);
    await this.setJsonConfig('course_default_params', '新增课程默认参数', normalized);
    return {
      success: true,
      params: normalized,
    };
  }

  getDefaultCourseSimilarityConfig() {
    return { threshold: 0.82 };
  }

  normalizeCourseSimilarityConfig(input?: Record<string, any> | null) {
    const fallback = this.getDefaultCourseSimilarityConfig();
    const raw = Number(input?.threshold ?? fallback.threshold);
    const threshold = Number.isFinite(raw)
      ? Math.min(0.99, Math.max(0.5, Math.round(raw * 100) / 100))
      : fallback.threshold;
    return { threshold };
  }

  async getCourseSimilarityConfig() {
    const value = await this.getJsonConfig(
      'course_similarity_config',
      this.getDefaultCourseSimilarityConfig(),
    );
    return this.normalizeCourseSimilarityConfig(value as Record<string, any>);
  }

  async setCourseSimilarityConfig(input: Record<string, any>) {
    const normalized = this.normalizeCourseSimilarityConfig(input);
    await this.setJsonConfig('course_similarity_config', '课程同名/类似检测参数', normalized);
    return {
      success: true,
      config: normalized,
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

  private getDefaultHomePopupConfig() {
    return {
      enabled: false,
      activeTemplateId: 'default',
      title: '',
      content: '',
      image: '',
      buttonText: '我知道了',
      showMode: 'once' as 'once' | 'always',
      pages: [],
      templates: [
        {
          id: 'default',
          name: '默认模板',
          title: '',
          buttonText: '我知道了',
          showMode: 'once' as 'once' | 'always',
          pages: [
            {
              id: 'page_1',
              title: '',
              content: '',
              image: '',
            },
          ],
        },
      ],
      version: 0,
    };
  }

  private stripRichText(html: string) {
    return String(html || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim();
  }

  private normalizeHomePopupTargetUserIds(input: unknown) {
    const rawValues = Array.isArray(input)
      ? input
      : String(input || '')
          .split(/[\s,，;；]+/)
          .filter(Boolean);
    return Array.from(
      new Set(
        rawValues
          .map((item) => Number(item))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    );
  }

  private normalizeHomePopupPage(input: Record<string, any>, index: number) {
    return {
      id: String(input?.id || `page_${index + 1}`).trim(),
      title: String(input?.title || '').trim(),
      content: String(input?.content || '').trim(),
      image: String(input?.image || '').trim(),
    };
  }

  private normalizeHomePopupTemplate(
    input: Record<string, any>,
    index: number,
  ) {
    const fallbackPage = {
      id: 'page_1',
      title: input?.title,
      content: input?.content,
      image: input?.image,
    };
    const rawPages = Array.isArray(input?.pages) ? input.pages : [fallbackPage];
    const pages = rawPages
      .map((page, pageIndex) =>
        this.normalizeHomePopupPage(page || {}, pageIndex),
      )
      .filter((page) => page.id);
    const showMode = input?.showMode === 'always' ? 'always' : 'once';
    const targetMode = input?.targetMode === 'specified' ? 'specified' : 'all';
    const targetUserIds = this.normalizeHomePopupTargetUserIds(input?.targetUserIds);
    const firstPage = pages[0] || this.normalizeHomePopupPage({}, 0);

    return {
      id: String(input?.id || `template_${index + 1}`).trim(),
      name:
        String(input?.name || input?.title || `模板 ${index + 1}`).trim() ||
        `模板 ${index + 1}`,
      title: String(input?.title || firstPage.title || '').trim(),
      buttonText: String(input?.buttonText || '').trim() || '我知道了',
      showMode,
      targetMode,
      targetUserIds,
      pages: pages.length ? pages : [firstPage],
    };
  }

  private normalizeHomePopupConfig(input: Record<string, any>) {
    const legacyTemplate = {
      id: 'default',
      name: '默认模板',
      title: input?.title,
      content: input?.content,
      image: input?.image,
      buttonText: input?.buttonText,
      showMode: input?.showMode,
      targetMode: input?.targetMode,
      targetUserIds: input?.targetUserIds,
    };
    const rawTemplates = Array.isArray(input?.templates)
      ? input.templates
      : [legacyTemplate];
    const templates = rawTemplates
      .map((template, index) =>
        this.normalizeHomePopupTemplate(template || {}, index),
      )
      .filter((template) => template.id);
    const fallbackTemplates = templates.length
      ? templates
      : [this.normalizeHomePopupTemplate(legacyTemplate, 0)];
    const requestedActiveTemplateId = String(
      input?.activeTemplateId || input?.active_template_id || '',
    ).trim();
    const activeTemplate =
      fallbackTemplates.find(
        (template) => template.id === requestedActiveTemplateId,
      ) || fallbackTemplates[0];
    const activePage = activeTemplate.pages[0] || this.normalizeHomePopupPage({}, 0);

    return {
      enabled: Boolean(input?.enabled),
      activeTemplateId: activeTemplate.id,
      title: activeTemplate.title || activePage.title,
      content: activePage.content,
      image: activePage.image,
      buttonText: activeTemplate.buttonText,
      showMode: activeTemplate.showMode,
      targetMode: activeTemplate.targetMode,
      targetUserIds: activeTemplate.targetUserIds,
      pages: activeTemplate.pages,
      templates: fallbackTemplates,
      version: Number(input?.version) || 0,
    };
  }

  private isHomePopupTemplateVisibleToUser(
    template: ReturnType<typeof this.normalizeHomePopupTemplate>,
    userId?: number,
  ) {
    if (template.targetMode !== 'specified') return true;
    if (!userId) return false;
    return template.targetUserIds.includes(userId);
  }

  async getHomePopupConfig() {
    const value = await this.getJsonConfig(
      'home_popup_config',
      this.getDefaultHomePopupConfig(),
    );
    return this.normalizeHomePopupConfig(value as Record<string, any>);
  }

  async getHomePopupConfigForUser(userId?: number) {
    const config = await this.getHomePopupConfig();
    const activeTemplate = config.templates.find(
      (template) => template.id === config.activeTemplateId,
    );
    if (!activeTemplate || !this.isHomePopupTemplateVisibleToUser(activeTemplate, userId)) {
      return null;
    }
    const firstPage = activeTemplate.pages[0] || this.normalizeHomePopupPage({}, 0);
    return {
      enabled: config.enabled,
      activeTemplateId: config.activeTemplateId,
      title: activeTemplate.title || firstPage.title,
      content: firstPage.content,
      image: firstPage.image,
      buttonText: activeTemplate.buttonText,
      showMode: activeTemplate.showMode,
      pages: activeTemplate.pages,
      version: config.version,
    };
  }

  async setHomePopupConfig(input: Record<string, any>) {
    const current = await this.getHomePopupConfig();
    const next = this.normalizeHomePopupConfig(input);
    const getVersionlessSnapshot = (config: Record<string, any>) => {
      const { version, ...rest } = config;
      return rest;
    };
    const contentChanged =
      JSON.stringify(getVersionlessSnapshot(next)) !==
      JSON.stringify(getVersionlessSnapshot(current as Record<string, any>));

    if (
      next.enabled &&
      !next.pages.some(
        (page) =>
          this.stripRichText(page.content) || page.title || page.image,
      )
    ) {
      throw new Error('启用弹窗时请至少填写一个轮播页的标题、正文或图片');
    }

    if (contentChanged) {
      next.version = Date.now();
    } else {
      next.version = current.version;
    }

    await this.setJsonConfig('home_popup_config', '小程序首页弹窗配置', next);
    return {
      success: true,
      config: next,
    };
  }

  /** 小程序版本策略：发布新版本时在环境变量或 system_config(miniapp_version) 中提高 minVersion */
  async getMiniappVersionPolicy() {
    const fromDb = await this.getJsonConfig<{
      minVersion?: string;
      latestVersion?: string;
      tip?: string;
    }>('miniapp_version', {});

    const minVersion = String(
      fromDb.minVersion || this.configService.get<string>('MINIAPP_MIN_VERSION', '') || '',
    ).trim();
    const latestVersion = String(
      fromDb.latestVersion ||
        this.configService.get<string>('MINIAPP_LATEST_VERSION', '') ||
        minVersion,
    ).trim();
    const tip =
      String(fromDb.tip || '').trim() ||
      '当前版本较旧，请完全退出小程序后重新进入，以加载最新版本。';

    return {
      minVersion,
      latestVersion,
      tip,
    };
  }
}
