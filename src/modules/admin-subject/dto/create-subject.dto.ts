import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateSubjectDto {
  @ApiProperty({ description: '科目名称', example: '数学' })
  @IsNotEmpty({ message: '科目名称不能为空' })
  @IsString()
  name: string;

  @ApiProperty({ description: '封面图片', required: false })
  @IsOptional()
  @IsString()
  cover_img?: string;

  @ApiProperty({ description: '价格', example: 99.99 })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiProperty({ description: '是否VIP免费', example: 0, enum: [0, 1] })
  @IsOptional()
  @IsNumber()
  is_vip_free?: number;

  @ApiProperty({ description: '排序', example: 0 })
  @IsOptional()
  @IsNumber()
  sort?: number;
}

