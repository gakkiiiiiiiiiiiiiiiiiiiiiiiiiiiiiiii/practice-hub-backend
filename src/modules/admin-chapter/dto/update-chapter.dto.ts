import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { ChapterType } from '../../../database/entities/chapter.entity';

export class UpdateChapterDto {
  @ApiProperty({ description: '科目ID', required: false })
  @IsOptional()
  @IsNumber()
  subject_id?: number;

  @ApiProperty({ description: '章节名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '章节类型', required: false, enum: ChapterType })
  @IsOptional()
  @IsEnum(ChapterType)
  type?: ChapterType;

  @ApiProperty({ description: '是否免费（试读）', required: false, enum: [0, 1] })
  @IsOptional()
  @IsNumber()
  is_free?: number;

  @ApiProperty({ description: '排序', required: false })
  @IsOptional()
  @IsNumber()
  sort?: number;
}

