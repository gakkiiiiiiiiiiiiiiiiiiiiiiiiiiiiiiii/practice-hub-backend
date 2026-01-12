import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateSubjectDto {
  @ApiProperty({ description: '科目名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '封面图片', required: false })
  @IsOptional()
  @IsString()
  cover_img?: string;

  @ApiProperty({ description: '价格', required: false })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiProperty({ description: '是否免费', required: false, enum: [0, 1] })
  @IsOptional()
  @IsNumber()
  is_free?: number;

  @ApiProperty({ description: '排序', required: false })
  @IsOptional()
  @IsNumber()
  sort?: number;
}

