import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { OrderStatus } from '../../../database/entities/order.entity';

export class GetAdminOrderListDto {
	@ApiPropertyOptional({ description: '页码', default: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number = 1;

	@ApiPropertyOptional({ description: '每页条数', default: 10 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	pageSize?: number = 10;

	@ApiPropertyOptional({ description: '订单状态' })
	@IsOptional()
	@IsIn(Object.values(OrderStatus))
	status?: OrderStatus;

	@ApiPropertyOptional({ description: '订单类型 course/package/category' })
	@IsOptional()
	@IsIn(['course', 'package', 'category'])
	order_type?: 'course' | 'package' | 'category';

	@ApiPropertyOptional({ description: '课程内容类型 normal/file/paper_exam' })
	@IsOptional()
	@IsIn(['normal', 'file', 'paper_exam'])
	content_type?: 'normal' | 'file' | 'paper_exam';

	@ApiPropertyOptional({ description: '是否仅返回需要纸质履约的订单' })
	@IsOptional()
	@Transform(({ value }) => value === true || value === 'true')
	@IsBoolean()
	paper_only?: boolean;

	@ApiPropertyOptional({ description: '云打印状态，unsubmitted 表示尚未创建云打印任务' })
	@IsOptional()
	@IsIn([
		'unsubmitted',
		'pending',
		'processing',
		'submitting',
		'waiting_files',
		'awaiting_confirm',
		'retryable_failed',
		'review_required',
		'submitted',
		'refund_reserved',
		'cancelled',
	])
	cloud_print_status?: string;

	@ApiPropertyOptional({ description: '关键词：订单号/用户昵称/手机号/用户ID' })
	@IsOptional()
	@IsString()
	keyword?: string;
}
