import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.get('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        const redisPassword = configService.get('REDIS_PASSWORD', '');
        const redisDb = configService.get<number>('REDIS_DB', 0);

        console.log(`[Redis配置] 连接地址: ${redisHost}:${redisPort}, DB: ${redisDb}`);

        const redis = new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword || undefined,
          db: redisDb,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            console.log(`[Redis] 连接失败，${delay}ms 后重试 (第 ${times} 次)`);
            return delay;
          },
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        });

        redis.on('connect', () => {
          console.log('[Redis] 连接成功');
        });

        redis.on('ready', () => {
          console.log('[Redis] 准备就绪');
        });

        redis.on('error', (err) => {
          console.error('[Redis] 连接错误:', err.message);
        });

        redis.on('close', () => {
          console.warn('[Redis] 连接已关闭');
        });

        redis.on('reconnecting', () => {
          console.log('[Redis] 正在重新连接...');
        });

        return redis;
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}

