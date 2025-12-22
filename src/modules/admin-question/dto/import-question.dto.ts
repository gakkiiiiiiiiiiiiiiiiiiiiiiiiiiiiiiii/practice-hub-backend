import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class ImportQuestionDto {
  @ApiProperty({ description: '章节ID', example: 1 })
  @IsNotEmpty({ message: '章节ID不能为空' })
  @IsNumber()
  chapterId: number;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Excel文件' })
  file: Express.Multer.File;
}

