import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AppUserSessionService } from './app-user-session.service';
import { DatabaseModule } from '../../database/database.module';
import { AppUser } from '../../database/entities/app-user.entity';
import { AppUserSession } from '../../database/entities/app-user-session.entity';
import { SysUser } from '../../database/entities/sys-user.entity';
import { DistributorModule } from '../distributor/distributor.module';
import { SystemRoleModule } from '../system-role/system-role.module';
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  imports: [
    DatabaseModule,
    DistributorModule,
    MarketingModule,
    forwardRef(() => SystemRoleModule), // 使用 forwardRef 解决循环依赖
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET', 'default_secret'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRE', '7d'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AppUserSessionService, JwtStrategy],
  exports: [AuthService, AppUserSessionService],
})
export class AuthModule {}

