import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCourseFileDto {
  @ApiProperty({ description: '展示名称' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  display_name: string;

  @ApiProperty({ description: '文件 URL' })
  @IsString()
  @IsNotEmpty()
  file_url: string;

  @ApiPropertyOptional({ description: '原始文件名' })
  @IsOptional()
  @IsString()
  file_name?: string;

  @ApiProperty({ description: '文件类型 pdf/doc/docx' })
  @IsString()
  @IsNotEmpty()
  file_type: string;

  @ApiPropertyOptional({ description: '文件大小（字节）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  file_size?: number;

  @ApiPropertyOptional({ description: '排序，越小越靠前' })
  @IsOptional()
  @IsInt()
  sort?: number;
}

export class UpdateCourseFileDto {
  @ApiPropertyOptional({ description: '展示名称' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  display_name?: string;

  @ApiPropertyOptional({ description: '文件 URL' })
  @IsOptional()
  @IsString()
  file_url?: string;

  @ApiPropertyOptional({ description: '原始文件名' })
  @IsOptional()
  @IsString()
  file_name?: string;

  @ApiPropertyOptional({ description: '文件类型' })
  @IsOptional()
  @IsString()
  file_type?: string;

  @ApiPropertyOptional({ description: '文件大小' })
  @IsOptional()
  @IsInt()
  @Min(0)
  file_size?: number;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @IsInt()
  sort?: number;
}
