import { Module } from '@nestjs/common';
import { SystemRoleService } from './system-role.service';
import { SystemRoleController } from './system-role.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
	imports: [AuthModule],
	controllers: [SystemRoleController],
	providers: [SystemRoleService],
})
export class SystemRoleModule {}
