import { Module } from '@nestjs/common';
import { PackageModule } from '../package/package.module';
import { AdminPackageController } from './admin-package.controller';

@Module({
	imports: [PackageModule],
	controllers: [AdminPackageController],
})
export class AdminPackageModule {}
