import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsObject, IsOptional, ValidateIf } from 'class-validator';

export class CreateOrderDto {
  @ApiPropertyOptional({ description: '课程ID（购买课程时必填）', example: 1 })
  @ValidateIf((dto) => !dto.order_type || dto.order_type === 'course')
  @IsNumber()
  course_id?: number;

  @ApiPropertyOptional({ description: '订单类型', enum: ['course', 'package', 'category'], default: 'course' })
  @IsOptional()
  @IsIn(['course', 'package', 'category'])
  order_type?: 'course' | 'package' | 'category';

  @ApiPropertyOptional({ description: '分类ID（购买整类课程时必填）' })
  @ValidateIf((dto) => dto.order_type === 'category')
  @IsNumber()
  category_id?: number;

  @ApiPropertyOptional({ description: '套餐ID（购买套餐时必填）' })
  @ValidateIf((dto) => dto.order_type === 'package')
  @IsNumber()
  package_section_id?: number;

  @ApiPropertyOptional({ description: '套餐规格ID（购买套餐时必填）' })
  @ValidateIf((dto) => dto.order_type === 'package')
  @IsNumber()
  package_plan_id?: number;

  @ApiPropertyOptional({ description: '优惠券ID' })
  @IsOptional()
  @IsNumber()
  coupon_id?: number;

  @ApiPropertyOptional({ description: '纸质专业真题收货地址' })
  @IsOptional()
  @IsObject()
  shipping_address?: Record<string, any>;
}
