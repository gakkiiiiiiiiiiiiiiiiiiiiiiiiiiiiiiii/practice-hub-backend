import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class SetDailyQuotesDto {
  @ApiProperty({ 
    description: '广播消息列表', 
    example: ['宝剑锋从磨砺出，梅花香自苦寒来。', '路漫漫其修远兮，吾将上下而求索。'],
    type: [String]
  })
  @IsArray({ message: '广播消息列表必须是数组' })
  @ArrayMinSize(1, { message: '至少需要一条广播消息' })
  @IsString({ each: true, message: '每条广播消息必须是字符串' })
  quotes: string[];
}
