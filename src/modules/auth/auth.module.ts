import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { DatabaseModule } from '../../database/database.module';
import { AppUser } from '../../database/entities/app-user.entity';
import { SysUser } from '../../database/entities/sys-user.entity';
import { DistributorModule } from '../distributor/distributor.module';
import { SystemRoleModule } from '../system-role/system-role.module';

@Module({
  imports: [
    DatabaseModule,
    DistributorModule,
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
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}

