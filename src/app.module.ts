import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { CourseModule } from './modules/course/course.module';
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
import { AdminCourseModule } from './modules/admin-course/admin-course.module';
import { AdminQuestionModule } from './modules/admin-question/admin-question.module';
import { AdminActivationCodeModule } from './modules/admin-activation-code/admin-activation-code.module';
import { AdminChapterModule } from './modules/admin-chapter/admin-chapter.module';
import { UploadModule } from './modules/upload/upload.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { DistributorModule } from './modules/distributor/distributor.module';
import { ExamModule } from './modules/exam/exam.module';
import { SystemAccountModule } from './modules/system-account/system-account.module';
import { SystemRoleModule } from './modules/system-role/system-role.module';
import { BannerModule } from './modules/banner/banner.module';
import { PageRouteModule } from './modules/page-route/page-route.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbHost = configService.get('DB_HOST', 'localhost');
        const dbPort = configService.get<number>('DB_PORT', 3306);
        const dbUsername = configService.get('DB_USERNAME', 'root');
        const dbPassword = configService.get('DB_PASSWORD', '');
        const dbDatabase = configService.get('DB_DATABASE', 'practice_hub');
        const nodeEnv = configService.get('NODE_ENV', 'development');

		// 安全：不在日志中打印敏感信息（如密码）
		console.log(`[数据库配置] 连接地址: ${dbHost}:${dbPort}, 数据库: ${dbDatabase}`);

        return {
          type: 'mysql',
          host: dbHost,
          port: dbPort,
          username: dbUsername,
          password: dbPassword,
          database: dbDatabase,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: nodeEnv === 'development',
          logging: nodeEnv === 'development',
          timezone: '+08:00',
          charset: 'utf8mb4',
          retryAttempts: 5,
          retryDelay: 3000,
          autoLoadEntities: true,
          // 连接池配置，防止 ECONNRESET 错误
          extra: {
            // 连接池最大连接数
            connectionLimit: 20,
            // 连接超时时间（毫秒）
            connectTimeout: 60000,
            // 获取连接超时时间（毫秒）
            acquireTimeout: 60000,
            // 连接空闲超时时间（毫秒），超过此时间未使用的连接会被关闭
            idleTimeout: 600000, // 10分钟
            // 连接最大存活时间（毫秒），超过此时间的连接会被关闭并重新创建
            maxIdle: 10,
            // 启用连接自动重连
            reconnect: true,
            // 连接被重置时自动重连
            enableKeepAlive: true,
            // Keep-alive 初始延迟（毫秒）
            keepAliveInitialDelay: 0,
            // 是否在连接断开时自动重连
            autoReconnect: true,
            // 连接重试次数
            reconnectAttempts: 10,
            // 连接重试延迟（毫秒）
            reconnectDelay: 2000,
            // 启用连接池队列
            queueLimit: 0,
            // 连接池最小连接数
            min: 2,
            // 连接池最大连接数
            max: 20,
            // 连接验证查询（用于保持连接活跃）
            evictionRunIntervalMillis: 10000,
            // 连接空闲时间（毫秒），超过此时间未使用的连接会被关闭
            idleTimeoutMillis: 300000,
            // 连接最大存活时间（毫秒）
            maxLifetime: 1800000, // 30分钟
          },
        };
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    UserModule,
    CourseModule,
    QuestionModule,
    OrderModule,
    ActivationCodeModule,
    WrongBookModule,
    CollectionModule,
    HomeModule,
    AdminModule, // 必须在 SystemModule 之前，避免路由冲突
    DashboardModule,
    SystemModule, // SystemController 使用 @Controller('admin')，可能拦截其他 admin 路由
    RecommendModule,
    AdminCourseModule,
    AdminQuestionModule,
    AdminActivationCodeModule,
    AdminChapterModule,
    UploadModule,
    FeedbackModule,
    DistributorModule,
    ExamModule,
    SystemAccountModule,
    SystemRoleModule,
    BannerModule,
    PageRouteModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggingMiddleware)
      .forRoutes('*'); // 应用到所有路由
  }
}

