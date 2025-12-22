import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { SubjectModule } from './modules/subject/subject.module';
import { QuestionModule } from './modules/question/question.module';
import { OrderModule } from './modules/order/order.module';
import { ActivationCodeModule } from './modules/activation-code/activation-code.module';
import { WrongBookModule } from './modules/wrong-book/wrong-book.module';
import { CollectionModule } from './modules/collection/collection.module';
import { HomeModule } from './modules/home/home.module';
import { AdminModule } from './modules/admin/admin.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SystemModule } from './modules/system/system.module';
import { RecommendModule } from './modules/recommend/recommend.module';
import { AdminSubjectModule } from './modules/admin-subject/admin-subject.module';
import { AdminQuestionModule } from './modules/admin-question/admin-question.module';
import { AdminActivationCodeModule } from './modules/admin-activation-code/admin-activation-code.module';
import { AdminChapterModule } from './modules/admin-chapter/admin-chapter.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get('DB_USERNAME', 'root'),
        password: configService.get('DB_PASSWORD', ''),
        database: configService.get('DB_DATABASE', 'practice_hub'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
        timezone: '+08:00',
        charset: 'utf8mb4',
        extra: {
          authPlugin: 'mysql_native_password',
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    DatabaseModule,
    AuthModule,
    UserModule,
    SubjectModule,
    QuestionModule,
    OrderModule,
    ActivationCodeModule,
    WrongBookModule,
    CollectionModule,
    HomeModule,
    AdminModule,
    DashboardModule,
    SystemModule,
    RecommendModule,
    AdminSubjectModule,
    AdminQuestionModule,
    AdminActivationCodeModule,
    AdminChapterModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}

