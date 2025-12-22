import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SortItem {
  @ApiProperty({ description: '记录ID', example: 1 })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ description: '排序值', example: 0 })
  @IsNotEmpty()
  sort: number;
}

export class UpdateItemSortDto {
  @ApiProperty({ description: '排序列表', type: [SortItem] })
  @IsNotEmpty({ message: '排序列表不能为空' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortItem)
  items: SortItem[];
}

