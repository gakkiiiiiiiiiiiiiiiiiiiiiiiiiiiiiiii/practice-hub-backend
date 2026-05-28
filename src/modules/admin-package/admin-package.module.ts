import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PackageModule } from '../package/package.module';
import { AdminPackageController } from './admin-package.controller';

@Module({
	imports: [DatabaseModule, PackageModule],
	controllers: [AdminPackageController],
})
export class AdminPackageModule {}
