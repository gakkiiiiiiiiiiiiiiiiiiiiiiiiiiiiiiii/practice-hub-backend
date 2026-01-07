import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ActivationCodeStatus } from '../../../database/entities/activation-code.entity';

export class GetCodeListDto {
  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pageSize?: number;

  @ApiProperty({ description: '批次号', example: 'BATCH1234567890', required: false })
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiProperty({ description: '状态', enum: ActivationCodeStatus, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsEnum(ActivationCodeStatus)
  status?: ActivationCodeStatus;
}

