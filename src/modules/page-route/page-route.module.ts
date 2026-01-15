import { Module } from '@nestjs/common';
import { PageRouteService } from './page-route.service';
import { PageRouteController } from './page-route.controller';
import { AppPageRouteController } from './app-page-route.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
	imports: [DatabaseModule],
	controllers: [PageRouteController, AppPageRouteController],
	providers: [PageRouteService],
	exports: [PageRouteService],
})
export class PageRouteModule {}
