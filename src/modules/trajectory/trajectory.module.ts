import { Module } from '@nestjs/common';
import { TrajectoryService } from './trajectory.service';
import { TrajectoryController } from './trajectory.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
	imports: [DatabaseModule],
	controllers: [TrajectoryController],
	providers: [TrajectoryService],
})
export class TrajectoryModule {}
