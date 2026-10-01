import { Type } from 'class-transformer';
import { IsInt, ValidateNested, Max, Min } from 'class-validator';
import { ZhiyePrintAddressDto } from './zhiye-print-address.dto';

export class UpdateZhiyePrintDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  copies: number;

  @ValidateNested()
  @Type(() => ZhiyePrintAddressDto)
  shippingAddress: ZhiyePrintAddressDto;
}
