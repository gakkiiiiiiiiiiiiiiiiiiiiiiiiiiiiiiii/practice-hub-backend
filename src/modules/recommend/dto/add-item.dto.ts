import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class AddItemDto {
  @ApiProperty({ description: '版块ID', example: 1 })
  @IsNotEmpty({ message: '版块ID不能为空' })
  @IsNumber()
  category_id: number;

  @ApiProperty({ description: '题库ID', example: 1 })
  @IsNotEmpty({ message: '题库ID不能为空' })
  @IsNumber()
  subject_id: number;

  @ApiProperty({ description: '排序', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  sort?: number;
}

