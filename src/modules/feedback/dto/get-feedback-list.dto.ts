import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FeedbackType, FeedbackStatus } from '../../../database/entities/feedback.entity';

export class GetFeedbackListDto {
	@ApiProperty({
		description: '页码',
		required: false,
		default: 1,
		minimum: 1,
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '页码必须是整数' })
	@Min(1, { message: '页码必须大于0' })
	page?: number = 1;

	@ApiProperty({
		description: '每页数量',
		required: false,
		default: 10,
		minimum: 1,
		maximum: 100,
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '每页数量必须是整数' })
	@Min(1, { message: '每页数量必须大于0' })
	pageSize?: number = 10;

	@ApiProperty({
		description: '反馈类型',
		enum: FeedbackType,
		required: false,
	})
	@IsOptional()
	@IsEnum(FeedbackType, { message: '反馈类型无效' })
	type?: FeedbackType;

	@ApiProperty({
		description: '处理状态',
		enum: FeedbackStatus,
		required: false,
	})
	@IsOptional()
	@IsEnum(FeedbackStatus, { message: '处理状态无效' })
	status?: FeedbackStatus;

	@ApiProperty({
		description: '用户ID',
		required: false,
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '用户ID必须是整数' })
	user_id?: number;
}

