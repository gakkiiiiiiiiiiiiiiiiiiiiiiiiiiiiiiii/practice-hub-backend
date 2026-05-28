import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PackageService } from './package.service';
import { PackageController } from './package.controller';

@Module({
	imports: [DatabaseModule],
	controllers: [PackageController],
	providers: [PackageService],
	exports: [PackageService],
})
export class PackageModule {}
