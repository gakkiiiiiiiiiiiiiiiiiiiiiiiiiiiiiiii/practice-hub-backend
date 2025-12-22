import { Module } from '@nestjs/common';
import { AdminActivationCodeService } from './admin-activation-code.service';
import { AdminActivationCodeController } from './admin-activation-code.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminActivationCodeController],
  providers: [AdminActivationCodeService],
})
export class AdminActivationCodeModule {}

