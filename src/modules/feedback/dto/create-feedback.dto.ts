import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsArray, IsOptional, MinLength, MaxLength } from 'class-validator';
import { FeedbackType } from '../../../database/entities/feedback.entity';

export class CreateFeedbackDto {
	@ApiProperty({
		description: '反馈类型',
		enum: FeedbackType,
		example: FeedbackType.BUG,
	})
	@IsEnum(FeedbackType, { message: '反馈类型必须是 bug、style 或 feature' })
	type: FeedbackType;

	@ApiProperty({
		description: '问题描述',
		example: '这是一个问题描述',
		minLength: 5,
		maxLength: 2000,
	})
	@IsString({ message: '问题描述必须是字符串' })
	@MinLength(5, { message: '问题描述至少5个字符' })
	@MaxLength(2000, { message: '问题描述最多2000个字符' })
	description: string;

	@ApiProperty({
		description: '图片URL数组',
		type: [String],
		required: false,
		example: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
	})
	@IsOptional()
	@IsArray({ message: '图片必须是数组' })
	@IsString({ each: true, message: '图片URL必须是字符串' })
	images?: string[];
}

