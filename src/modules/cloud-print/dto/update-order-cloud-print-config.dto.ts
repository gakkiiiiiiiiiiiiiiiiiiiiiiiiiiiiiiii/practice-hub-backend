import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateOrderCloudPrintConfigDto {
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

  @IsBoolean()
  autoBindByPageCount: boolean;

  @IsInt() @IsIn([1, 2])
  coverMedia: number;

  @IsInt() @IsIn([1, 2, 3, 4, 5, 6])
  coverColor: number;

  @IsInt() @IsIn([1, 2, 3, 4, 5, 6, 7, 8, 9])
  coverContentType: number;

  @IsOptional() @IsString() @MaxLength(2000)
  coverContentValue?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  coverContentValue2?: string;

  @IsInt() @IsIn([0, 1])
  printCollate: number;

  @IsInt() @IsIn([0, 1, 2])
  orientation: number;

  @IsInt() @Min(1) @Max(999)
  shipSupplierId: number;
}
