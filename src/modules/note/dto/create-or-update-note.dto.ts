import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateOrUpdateNoteDto {
  @ApiProperty({ description: '题目ID', example: 1 })
  @IsNotEmpty({ message: '题目ID不能为空' })
  @IsNumber()
  question_id: number;

  @ApiProperty({ description: '笔记内容', example: '这是关于这道题的笔记...' })
  @IsNotEmpty({ message: '笔记内容不能为空' })
  @IsString()
  content: string;
}
