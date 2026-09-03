import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { PaymentBillChannel } from "../../database/entities/payment-bill.entity";

export class BillPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class BillListDto extends BillPageDto {
  @IsOptional() @IsIn(["wechat", "xpay"]) channel?: PaymentBillChannel;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
}
export class FetchBillDto {
  @IsIn(["wechat", "xpay"]) channel: PaymentBillChannel;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) billDate: string;
}
export class BillDownloadDto {
  @IsOptional() @IsIn(["original", "xlsx"]) format: "original" | "xlsx" =
    "original";
}
