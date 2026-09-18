import { Module, forwardRef } from '@nestjs/common';
import { ActivationCodeService } from './activation-code.service';
import { ActivationCodeController } from './activation-code.controller';
import { DatabaseModule } from '../../database/database.module';
import { DistributorModule } from '../distributor/distributor.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => DistributorModule)],
  controllers: [ActivationCodeController],
  providers: [ActivationCodeService],
  exports: [ActivationCodeService],
})
export class ActivationCodeModule {}
