import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class CreateOrderDto {
  @ApiPropertyOptional({ description: '课程ID（购买课程时必填）', example: 1 })
  @ValidateIf((dto) => !dto.order_type || dto.order_type === 'course')
  @IsNumber()
  course_id?: number;

  @ApiPropertyOptional({ description: '订单类型', enum: ['course', 'package', 'category'], default: 'course' })
  @IsOptional()
  @IsIn(['course', 'package', 'category'])
  order_type?: 'course' | 'package' | 'category';

  @ApiPropertyOptional({ description: '资料交付形式', enum: ['digital', 'paper'], default: 'digital' })
  @IsOptional()
  @IsIn(['digital', 'paper'])
  fulfillment_type?: 'digital' | 'paper';

  @ApiPropertyOptional({ description: '纸质资料购买数量', minimum: 1, maximum: 99, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '购买数量必须是整数' })
  @Min(1, { message: '购买数量不能少于1份' })
  @Max(99, { message: '单次最多购买99份' })
  quantity?: number;

  @ApiPropertyOptional({ description: '纸质资料页面确认的订单金额（元），服务器重新核价不一致时拒绝下单' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  expected_amount?: number;

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

  @ApiPropertyOptional({ description: '纸质资料收货地址' })
  @IsOptional()
  @IsObject()
  shipping_address?: Record<string, any>;
}
