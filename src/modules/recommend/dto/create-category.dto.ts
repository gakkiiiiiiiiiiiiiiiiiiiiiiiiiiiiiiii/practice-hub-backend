import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsIn } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: '版块名称', example: '热门公共课' })
  @IsNotEmpty({ message: '版块名称不能为空' })
  @IsString()
  name: string;

  @ApiProperty({ description: '排序权重', example: 0 })
  @IsOptional()
  @IsNumber()
  sort?: number;

  @ApiProperty({ description: '状态', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsNumber()
  @IsIn([0, 1])
  status?: number;
}

