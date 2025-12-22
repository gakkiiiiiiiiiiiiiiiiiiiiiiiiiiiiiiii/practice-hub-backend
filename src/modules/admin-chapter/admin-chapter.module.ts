import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminChapterController } from './admin-chapter.controller';
import { AdminChapterService } from './admin-chapter.service';
import { Chapter } from '../../database/entities/chapter.entity';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([Chapter])],
  controllers: [AdminChapterController],
  providers: [AdminChapterService],
  exports: [AdminChapterService],
})
export class AdminChapterModule {}

