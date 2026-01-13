import { Module, forwardRef } from '@nestjs/common';
import { SystemRoleService } from './system-role.service';
import { SystemRoleController } from './system-role.controller';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
	imports: [forwardRef(() => AuthModule), DatabaseModule], // 使用 forwardRef 解决循环依赖
	controllers: [SystemRoleController],
	providers: [SystemRoleService],
	exports: [SystemRoleService],
})
export class SystemRoleModule {}
