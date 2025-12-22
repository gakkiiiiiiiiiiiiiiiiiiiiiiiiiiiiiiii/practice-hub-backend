import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, IsEnum } from 'class-validator';
import { ChapterType } from '../../../database/entities/chapter.entity';

export class CreateChapterDto {
  @ApiProperty({ description: '科目ID', example: 1 })
  @IsNotEmpty({ message: '科目ID不能为空' })
  @IsNumber()
  subject_id: number;

  @ApiProperty({ description: '章节名称', example: '2023年真题' })
  @IsNotEmpty({ message: '章节名称不能为空' })
  @IsString()
  name: string;

  @ApiProperty({ description: '章节类型', example: 'year', enum: ChapterType, required: false })
  @IsOptional()
  @IsEnum(ChapterType)
  type?: ChapterType;

  @ApiProperty({ description: '是否免费（试读）', example: 0, enum: [0, 1], required: false })
  @IsOptional()
  @IsNumber()
  is_free?: number;

  @ApiProperty({ description: '排序', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  sort?: number;
}

