import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Distributor } from '../../database/entities/distributor.entity';
import { DistributionRelation } from '../../database/entities/distribution-relation.entity';
import { DistributionOrder } from '../../database/entities/distribution-order.entity';
import { DistributionConfig } from '../../database/entities/distribution-config.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order } from '../../database/entities/order.entity';
import { ActivationCode } from '../../database/entities/activation-code.entity';
import { Course } from '../../database/entities/course.entity';
import { DistributorService } from './distributor.service';
import { DistributorController } from './distributor.controller';
import { AdminDistributorController } from './admin-distributor.controller';
import { OrderModule } from '../order/order.module';
import { UploadModule } from '../upload/upload.module';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Distributor,
			DistributionRelation,
			DistributionOrder,
			DistributionConfig,
			AppUser,
			Order,
			ActivationCode,
			Course,
		]),
		forwardRef(() => OrderModule),
		forwardRef(() => UploadModule),
	],
	controllers: [DistributorController, AdminDistributorController],
	providers: [DistributorService],
	exports: [DistributorService],
})
export class DistributorModule {}
