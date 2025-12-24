import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsArray, IsOptional, IsString } from 'class-validator';

export class SubmitAnswerDto {
  @ApiProperty({ description: '题目ID', example: 1 })
  @IsNotEmpty({ message: '题目ID不能为空' })
  @IsNumber()
  qid: number;

  @ApiProperty({ description: '用户答案（选项类型题目使用）', example: ['A'], required: false })
  @IsOptional()
  @IsArray()
  options?: string[];

  @ApiProperty({ description: '文本答案（简答题使用）', example: '这是简答题的答案', required: false })
  @IsOptional()
  @IsString()
  text_answer?: string;

  @ApiProperty({ description: '图片答案URL（简答题使用）', example: 'https://example.com/image.jpg', required: false })
  @IsOptional()
  @IsString()
  image_answer?: string;
}

