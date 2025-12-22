import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';

export class UpdateCategoryDto {
  @ApiProperty({ description: '版块名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '排序权重', required: false })
  @IsOptional()
  @IsNumber()
  sort?: number;

  @ApiProperty({ description: '状态', required: false, enum: [0, 1] })
  @IsOptional()
  @IsNumber()
  @IsIn([0, 1])
  status?: number;
}

