import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysErrorLog } from '../../database/entities/sys-error-log.entity';
import { ClientErrorController } from './client-error.controller';
import { ClientErrorService } from './client-error.service';

@Module({
	imports: [TypeOrmModule.forFeature([SysErrorLog])],
	controllers: [ClientErrorController],
	providers: [ClientErrorService],
})
export class ClientErrorModule {}
