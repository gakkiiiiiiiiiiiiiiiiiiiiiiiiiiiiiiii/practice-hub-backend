import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetErrorLogsDto {
  @ApiProperty({ description: '页码', required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 20;

  @ApiProperty({ description: '搜索关键词（URL、错误消息、SQL错误）', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ description: 'HTTP状态码', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  status?: number;

  @ApiProperty({ description: '请求方法', required: false })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiProperty({ description: '开始时间', required: false })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiProperty({ description: '结束时间', required: false })
  @IsOptional()
  @IsDateString()
  endTime?: string;
}
