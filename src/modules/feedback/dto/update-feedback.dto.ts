import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional, IsInt } from 'class-validator';
import { FeedbackStatus } from '../../../database/entities/feedback.entity';

export class UpdateFeedbackDto {
	@ApiProperty({
		description: '处理状态',
		enum: FeedbackStatus,
		required: false,
	})
	@IsOptional()
	@IsEnum(FeedbackStatus, { message: '处理状态无效' })
	status?: FeedbackStatus;

	@ApiProperty({
		description: '管理员回复',
		required: false,
		example: '感谢您的反馈，我们已处理',
	})
	@IsOptional()
	@IsString({ message: '回复必须是字符串' })
	reply?: string;

	@ApiProperty({
		description: '处理人ID',
		required: false,
	})
	@IsOptional()
	@IsInt({ message: '处理人ID必须是整数' })
	handler_id?: number;
}

