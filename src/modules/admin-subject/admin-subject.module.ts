import { Module } from '@nestjs/common';
import { AdminSubjectService } from './admin-subject.service';
import { AdminSubjectController } from './admin-subject.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminSubjectController],
  providers: [AdminSubjectService],
})
export class AdminSubjectModule {}

