import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
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
	@Max(50)
	pageSize?: number = 10;

	@ApiPropertyOptional({ description: '订单状态' })
	@IsOptional()
	@IsIn(Object.values(OrderStatus))
	status?: OrderStatus;

	@ApiPropertyOptional({ description: '订单类型 course/package/category' })
	@IsOptional()
	@IsIn(['course', 'package', 'category'])
	order_type?: 'course' | 'package' | 'category';

	@ApiPropertyOptional({ description: '关键词：订单号/用户昵称/手机号/用户ID' })
	@IsOptional()
	@IsString()
	keyword?: string;
}
