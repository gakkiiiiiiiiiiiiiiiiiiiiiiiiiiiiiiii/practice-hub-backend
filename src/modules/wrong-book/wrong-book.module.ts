import { Module } from '@nestjs/common';
import { WrongBookService } from './wrong-book.service';
import { WrongBookController } from './wrong-book.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [WrongBookController],
  providers: [WrongBookService],
})
export class WrongBookModule {}

