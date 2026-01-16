import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class SetDailyQuotesDto {
  @ApiProperty({ 
    description: '每日提示语列表', 
    example: ['宝剑锋从磨砺出，梅花香自苦寒来。', '路漫漫其修远兮，吾将上下而求索。'],
    type: [String]
  })
  @IsArray({ message: '提示语列表必须是数组' })
  @ArrayMinSize(1, { message: '至少需要一条提示语' })
  @IsString({ each: true, message: '每条提示语必须是字符串' })
  quotes: string[];
}
