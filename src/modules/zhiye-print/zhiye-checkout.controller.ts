import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CommonResponseDto } from "../../common/dto/common-response.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CreateZhiyePrintOrderDto } from "./dto/create-zhiye-print-order.dto";
import { ZhiyeCheckoutService } from "./zhiye-checkout.service";
import { ZhiyeAppGuard } from "./zhiye-app.guard";

@ApiTags("知页云打印订单")
@Controller("app/zhiye-print")
@UseGuards(JwtAuthGuard, ZhiyeAppGuard)
@ApiBearerAuth()
export class ZhiyeCheckoutController {
  constructor(private readonly checkoutService: ZhiyeCheckoutService) {}

  @Post("drafts/:id/order")
  @ApiOperation({ summary: "使用有效报价幂等创建知页云打印订单" })
  async createOrder(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) draftId: number,
    @Body() dto: CreateZhiyePrintOrderDto,
  ) {
    return CommonResponseDto.success(
      await this.checkoutService.createOrder(
        user.userId,
        draftId,
        dto.quoteVersion,
      ),
    );
  }

  @Get("orders")
  @ApiOperation({ summary: "获取本人的知页云打印订单" })
  async listOrders(
    @CurrentUser() user: any,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return CommonResponseDto.success(
      await this.checkoutService.listOrders(
        user.userId,
        Number(page),
        Number(pageSize),
      ),
    );
  }

  @Get("orders/:id")
  @ApiOperation({ summary: "获取本人的知页云打印订单详情" })
  async getOrder(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) orderId: number,
  ) {
    return CommonResponseDto.success(
      await this.checkoutService.getOrder(user.userId, orderId),
    );
  }
}
