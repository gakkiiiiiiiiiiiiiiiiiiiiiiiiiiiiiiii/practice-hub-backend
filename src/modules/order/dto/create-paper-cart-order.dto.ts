import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsNumber, IsObject, Max, Min, ValidateNested } from 'class-validator';

export class PaperCartItemDto {
  @ApiProperty({ description: '已拥有的文件课程 ID', minimum: 1 })
  @IsInt()
  @Min(1)
  course_id: number;

  @ApiProperty({ description: '纸质资料份数', minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
}

export class CreatePaperCartOrderDto {
  @ApiProperty({ type: [PaperCartItemDto], description: '1–20 种资料，同一课程不可重复' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: PaperCartItemDto) => item?.course_id)
  @ValidateNested({ each: true })
  @Type(() => PaperCartItemDto)
  items: PaperCartItemDto[];

  @ApiProperty({ description: '收货地址：name、phone、province、city、district、detail' })
  @IsObject()
  shipping_address: Record<string, any>;

  @ApiProperty({ description: '页面展示的合计金额（元），服务器重新核价不一致时拒绝下单', minimum: 0.01 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  expected_amount: number;
}
