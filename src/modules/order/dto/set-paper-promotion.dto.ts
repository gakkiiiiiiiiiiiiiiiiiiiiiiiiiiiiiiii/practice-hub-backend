import { IsBoolean, IsInt, Max, Min } from "class-validator";

export class SetPaperPromotionDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(2)
  @Max(20)
  minimum_items: number;

  @IsInt()
  @Min(1)
  @Max(100)
  discount_per_additional_item: number;
}
