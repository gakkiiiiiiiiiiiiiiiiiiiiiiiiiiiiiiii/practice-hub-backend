import { Module } from '@nestjs/common';
import { ActivationCodeService } from './activation-code.service';
import { ActivationCodeController } from './activation-code.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ActivationCodeController],
  providers: [ActivationCodeService],
  exports: [ActivationCodeService],
})
export class ActivationCodeModule {}

