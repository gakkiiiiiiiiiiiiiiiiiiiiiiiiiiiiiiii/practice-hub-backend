import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BannerService } from '../banner/banner.service';

const QUOTES = [
  '宝剑锋从磨砺出，梅花香自苦寒来。',
  '不经一番寒彻骨，怎得梅花扑鼻香。',
  '路漫漫其修远兮，吾将上下而求索。',
  '天行健，君子以自强不息。',
  '业精于勤，荒于嬉；行成于思，毁于随。',
  '书山有路勤为径，学海无涯苦作舟。',
  '只要功夫深，铁杵磨成针。',
  '不积跬步，无以至千里；不积小流，无以成江海。',
];

@Injectable()
export class HomeService {
  constructor(
    private configService: ConfigService,
    private bannerService: BannerService,
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
   */
  async getDailyQuote() {
    const today = new Date().toISOString().split('T')[0];
    
    // 使用日期作为随机种子，确保同一天返回相同的语录
    const dateHash = today.split('-').reduce((acc, val) => acc + parseInt(val, 10), 0);
    const randomIndex = dateHash % QUOTES.length;
    const quote = QUOTES[randomIndex];

    return { quote };
  }
}

