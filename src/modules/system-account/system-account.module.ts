import { Module } from '@nestjs/common';
import { SystemAccountService } from './system-account.service';
import { SystemAccountController } from './system-account.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
	imports: [DatabaseModule],
	controllers: [SystemAccountController],
	providers: [SystemAccountService],
})
export class SystemAccountModule {}
