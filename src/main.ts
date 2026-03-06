import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		bodyParser: false, // 自行配置以增大 JSON/urlencoded 限制
	});
	// 提高请求体大小限制：JSON/表单 50mb；文件上传由各接口 Multer 限制（如 process-pdf 为 50mb）
	// 若 /api/admin/process-pdf/extract 仍返回 413，需在网关/云托管侧提高限制（如 nginx client_max_body_size）
	const bodyLimit = process.env.BODY_LIMIT || '200mb';
	app.use(express.json({ limit: bodyLimit }));
	app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

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
		}),
	);

	// 跨域配置 - 允许所有来源
	app.enableCors({
		origin: true, // 允许所有来源
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
		allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
		exposedHeaders: ['Content-Length', 'Content-Type'],
		maxAge: 86400, // 24小时，减少OPTIONS预检请求
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
