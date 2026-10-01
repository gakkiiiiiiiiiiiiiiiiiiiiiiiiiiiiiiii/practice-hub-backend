import { IsString, Matches } from "class-validator";

export class CreateZhiyePrintOrderDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: "报价版本无效，请重新获取报价" })
  quoteVersion: string;
}
