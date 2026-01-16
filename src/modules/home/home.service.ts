import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BannerService } from '../banner/banner.service';
import { SystemService } from '../system/system.service';

@Injectable()
export class HomeService {
  constructor(
    private configService: ConfigService,
    private bannerService: BannerService,
    private systemService: SystemService,
  ) {}

  /**
   * 获取首页配置
   */
  async getHomeConfig() {
    // 从配置或数据库获取倒计时日期
    const countdownDate = this.configService.get('COUNTDOWN_DATE', '2024-12-23');
    
    // 从数据库获取启用的轮播图列表
    const banners = await this.bannerService.getActiveBanners();

    return {
      countdown_date: countdownDate,
      banners,
    };
  }

  /**
   * 获取每日励志语录
   * 返回所有提示语列表，支持前端轮播显示
   * 从系统配置中读取提示语列表
   */
  async getDailyQuote() {
    const quotes = await this.systemService.getDailyQuotes();
    
    if (quotes.length === 0) {
      return { quotes: ['研途漫漫，终抵群星。'] };
    }

    // 返回所有提示语，由前端进行轮播
    return { quotes };
  }
}

