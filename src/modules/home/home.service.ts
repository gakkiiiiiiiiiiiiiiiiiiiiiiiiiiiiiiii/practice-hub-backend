import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service';

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
    private redisService: RedisService,
    private configService: ConfigService,
  ) {}

  /**
   * 获取首页配置
   */
  async getHomeConfig() {
    // 从配置或数据库获取倒计时日期
    const countdownDate = this.configService.get('COUNTDOWN_DATE', '2024-12-23');
    
    // Banner 列表（可以从数据库或配置获取）
    const banners = [
      {
        id: 1,
        image: 'https://example.com/banner1.jpg',
        link: '/pages/subject/1',
      },
    ];

    return {
      countdown_date: countdownDate,
      banners,
    };
  }

  /**
   * 获取每日励志语录
   */
  async getDailyQuote() {
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `daily_quote:${today}`;

    // 尝试从缓存获取
    let quote = await this.redisService.get(cacheKey);

    if (!quote) {
      // 随机选择一条语录
      const randomIndex = Math.floor(Math.random() * QUOTES.length);
      quote = QUOTES[randomIndex];

      // 缓存到 Redis，24小时过期
      await this.redisService.set(cacheKey, quote, 86400);
    }

    return { quote };
  }
}

