import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { ZhiyePrintAddressDto } from './zhiye-print-address.dto';

export class QuoteZhiyePrintDraftDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  copies?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ZhiyePrintAddressDto)
  shippingAddress?: ZhiyePrintAddressDto;
}
