import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);

	// 配置静态文件服务，用于访问上传的文件
	const uploadsPath = join(process.cwd(), 'uploads');
	app.useStaticAssets(uploadsPath, {
		prefix: '/uploads',
	});
	console.log(`[静态文件] 配置上传目录: ${uploadsPath}`);

	// 全局验证管道
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: {
				enableImplicitConversion: false, // 禁用隐式转换，使用 DTO 中的 @Transform 装饰器手动转换
			},
			exceptionFactory: (errors) => {
				// 自定义错误格式，便于调试
				const messages = errors.map((error) => {
					const constraints = error.constraints || {};
					return Object.values(constraints).join(', ');
				});
				return new BadRequestException({
					message: '请求参数验证失败',
					errors: messages,
					details: errors,
				});
			},
		})
	);

	// 跨域配置
	// 安全：限制允许的来源，避免过于宽松的 CORS 配置
	const allowedOrigins = process.env.ALLOWED_ORIGINS
		? process.env.ALLOWED_ORIGINS.split(',')
		: ['http://localhost:3000', 'http://localhost:5173']; // 开发环境默认允许的源

	app.enableCors({
		origin: (origin, callback) => {
			// 允许没有 origin 的请求（如移动应用、Postman 等）
			if (!origin) {
				return callback(null, true);
			}
			// 检查 origin 是否在允许列表中
			if (allowedOrigins.includes(origin)) {
				callback(null, true);
			} else {
				// 生产环境严格检查，开发环境可以放宽
				const nodeEnv = process.env.NODE_ENV || 'development';
				if (nodeEnv === 'development') {
					callback(null, true);
				} else {
					callback(new Error('不允许的跨域请求'));
				}
			}
		},
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
	});

	// API 前缀
	// 注意：微信云托管可能需要配置路径映射，如果接口404，检查云托管的路由配置
	app.setGlobalPrefix('api', {
		exclude: ['/', '/health'], // 排除根路径和健康检查路径
	});

	// Swagger 文档
	const config = new DocumentBuilder()
		.setTitle('考研刷题小程序 API')
		.setDescription('考研刷题小程序后端 API 文档')
		.setVersion('1.0')
		.addBearerAuth()
		.build();
	const document = SwaggerModule.createDocument(app, config);
	SwaggerModule.setup('api-docs', app, document);

	// 微信云托管可以通过环境变量 PORT 配置端口
	// 默认使用 8080 端口（避免 80 端口需要 root 权限的问题）
	const port = parseInt(process.env.PORT || '8080', 10);
	await app.listen(port, '0.0.0.0');
	console.log(`🚀 服务启动成功: http://0.0.0.0:${port}`);
	console.log(`📚 API 文档: http://0.0.0.0:${port}/api-docs`);
}

bootstrap();
