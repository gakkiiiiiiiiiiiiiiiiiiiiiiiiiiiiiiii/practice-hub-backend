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
   * 根据日期生成固定的随机数，确保同一天返回相同的语录
   * 从系统配置中读取提示语列表
   */
  async getDailyQuote() {
    const quotes = await this.systemService.getDailyQuotes();
    
    if (quotes.length === 0) {
      return { quote: '研途漫漫，终抵群星。' };
    }

    const today = new Date().toISOString().split('T')[0];
    
    // 使用日期作为随机种子，确保同一天返回相同的语录
    const dateHash = today.split('-').reduce((acc, val) => acc + parseInt(val, 10), 0);
    const randomIndex = dateHash % quotes.length;
    const quote = quotes[randomIndex];

    return { quote };
  }
}

