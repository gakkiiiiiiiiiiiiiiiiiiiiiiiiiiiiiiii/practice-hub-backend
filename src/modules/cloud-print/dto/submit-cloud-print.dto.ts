import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class SubmitCloudPrintDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedTotalAmountCents?: number;

  @IsOptional()
  @IsBoolean()
  payAfter?: boolean;
}
