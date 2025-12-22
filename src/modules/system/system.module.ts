import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { DatabaseModule } from '../../database/database.module';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}

