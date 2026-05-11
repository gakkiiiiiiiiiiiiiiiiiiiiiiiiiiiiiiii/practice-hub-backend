import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class UploadImageBase64Dto {
	@ApiProperty({ description: '图片 Base64，可带 data:image/jpeg;base64, 前缀' })
	@IsString()
	@MaxLength(4_000_000)
	imageBase64: string;

	@ApiProperty({ required: false, description: '原始文件名，用于推断扩展名' })
	@IsOptional()
	@IsString()
	@MaxLength(200)
	fileName?: string;

	@ApiProperty({ required: false, description: '存储目录，默认 avatars' })
	@IsOptional()
	@IsString()
	@Matches(/^[a-zA-Z0-9_-]{1,64}$/)
	folder?: string;
}
