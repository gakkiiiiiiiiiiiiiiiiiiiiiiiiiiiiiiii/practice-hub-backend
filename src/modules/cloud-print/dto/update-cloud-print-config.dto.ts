import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';

export class UpdateCloudPrintConfigDto {
  @IsBoolean()
  autoEnabled: boolean;

  @IsInt() @IsIn([8, 9, 13])
  paperSize: number;

  @IsInt() @IsIn([1, 2])
  duplex: number;

  @IsInt() @IsIn([1, 2, 3, 4])
  color: number;

  @IsInt() @IsIn([1, 2, 4, 6])
  paperMedia: number;

  @IsInt() @IsIn([1, 2, 3, 4, 6, 9])
  pagesInOne: number;

  @IsInt() @IsIn([0, 1, 2, 3, 4])
  bindType: number;

  @IsInt() @IsIn([0, 1])
  printCollate: number;

  @IsInt() @IsIn([0, 1, 2])
  orientation: number;

  @IsInt() @Min(1) @Max(999)
  shipSupplierId: number;

  @IsInt() @Min(1) @Max(10000000)
  maxSingleAmountCents: number;
}
