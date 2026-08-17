import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ReportClientErrorDto {
	@ApiProperty({
		description: '错误事件类型',
		example: 'virtual_payment_failed',
	})
	@IsString()
	@MinLength(1)
	@MaxLength(64)
	@Matches(/^[a-z][a-z0-9_]*$/, { message: 'eventType 格式不正确' })
	eventType: string;

	@ApiProperty({ description: '错误消息', maxLength: 1000 })
	@IsString()
	@MinLength(1)
	@MaxLength(1000)
	message: string;

	@ApiProperty({
		description: '错误级别',
		required: false,
		enum: ['error', 'warn'],
	})
	@IsOptional()
	@IsIn(['error', 'warn'])
	level?: 'error' | 'warn';

	@ApiProperty({ description: '错误码', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	code?: string;

	@ApiProperty({ description: '小程序页面路由', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	page?: string;

	@ApiProperty({ description: '错误栈', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(20000)
	stack?: string;

	@ApiProperty({ description: '客户端运行环境', required: false })
	@IsOptional()
	@IsObject()
	runtime?: Record<string, unknown>;

	@ApiProperty({
		description: '业务上下文（禁止包含支付签名等敏感数据）',
		required: false,
	})
	@IsOptional()
	@IsObject()
	context?: Record<string, unknown>;

	@ApiProperty({ description: '错误指纹', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(128)
	fingerprint?: string;

	@ApiProperty({ description: '客户端错误发生时间', required: false })
	@IsOptional()
	@IsDateString()
	occurredAt?: string;
}
