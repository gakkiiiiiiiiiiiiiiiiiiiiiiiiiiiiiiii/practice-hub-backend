import { Controller, Post, Body, Get, UseGuards, Headers, Query, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';

@ApiTags('订单')
@Controller('app/order')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('create')
  @ApiOperation({ summary: '创建预支付订单' })
  async createOrder(@CurrentUser() user: any, @Body() dto: CreateOrderDto) {
    const result = await this.orderService.createOrder(user.userId, dto);
    return CommonResponseDto.success(result);
  }

  @Post('pay/confirm')
  @ApiOperation({ summary: '确认微信支付结果并开通课程权限' })
  async confirmWechatPayment(@CurrentUser() user: any, @Body() dto: ConfirmPaymentDto) {
    const result = await this.orderService.confirmWechatPayment(user.userId, dto.order_no);
    return CommonResponseDto.success(result);
  }

  @Get('list')
  @ApiOperation({ summary: '获取我的订单列表' })
  async getOrderList(@CurrentUser() user: any, @Query('status') status?: string) {
    const result = await this.orderService.getOrderList(user.userId, status);
    return CommonResponseDto.success(result);
  }

  @Post(':id/pay')
  @ApiOperation({ summary: '继续支付待支付订单' })
  async payPendingOrder(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    const result = await this.orderService.payPendingOrder(user.userId, id);
    return CommonResponseDto.success(result);
  }

  @Get('counts')
  @ApiOperation({ summary: '获取订单统计数量' })
  async getOrderCounts(@CurrentUser() user: any) {
    const result = await this.orderService.getOrderCounts(user.userId);
    return CommonResponseDto.success(result);
  }
}

@ApiTags('微信支付通知')
@Controller('app/order/pay')
export class OrderPayNotifyController {
  constructor(private readonly orderService: OrderService) {}

  @Post('notify')
  @ApiOperation({ summary: '微信支付结果通知' })
  async notify(@Headers() headers: Record<string, any>, @Body() body: Record<string, any>) {
    return this.orderService.handleWechatPayNotify(headers, body);
  }
}
