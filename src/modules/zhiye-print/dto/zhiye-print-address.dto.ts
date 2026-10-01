import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ZhiyePrintAddressDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsString()
  @MaxLength(50)
  province: string;

  @IsString()
  @MaxLength(50)
  city: string;

  @IsString()
  @MaxLength(50)
  district: string;

  @IsString()
  @MaxLength(200)
  detail: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  nationalCode?: string;
}
