import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CourseService } from './course.service';
import { CourseFileService } from './course-file.service';
import { CourseController } from './course.controller';
import { AppPdfViewerController } from './app-pdf-viewer.controller';
import { DatabaseModule } from '../../database/database.module';
import { UploadModule } from '../upload/upload.module';
import { PackageModule } from '../package/package.module';

@Module({
  imports: [
    DatabaseModule,
    UploadModule,
    ConfigModule,
    PackageModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'default_secret'),
        signOptions: { expiresIn: '5m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CourseController, AppPdfViewerController],
  providers: [CourseService, CourseFileService],
  exports: [CourseService, CourseFileService],
})
export class CourseModule {}
