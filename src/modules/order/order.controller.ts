import { Controller, Post, Body, Get, UseGuards, Headers, Query, Param, ParseIntPipe, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { OrderService } from './order.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateCartOrderDto } from './dto/create-cart-order.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { GetAdminOrderListDto } from './dto/get-admin-order-list.dto';
import { RefundOrderDto } from './dto/refund-order.dto';

function resolveClientIp(req: Request) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || req.ip || '127.0.0.1';
}

@ApiTags('订单')
@Controller('app/order')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('create')
  @ApiOperation({ summary: '创建预支付订单' })
  async createOrder(@CurrentUser() user: any, @Body() dto: CreateOrderDto, @Req() req: Request) {
    const result = await this.orderService.createOrder(user.userId, dto, resolveClientIp(req));
    return CommonResponseDto.success(result);
  }

  @Post('create-cart')
  @ApiOperation({ summary: '购物车合单下单' })
  async createCartOrder(@CurrentUser() user: any, @Body() dto: CreateCartOrderDto, @Req() req: Request) {
    const result = await this.orderService.createCartOrder(user.userId, dto, resolveClientIp(req));
    return CommonResponseDto.success(result);
  }

  @Post('pay/confirm')
  @ApiOperation({ summary: '确认微信虚拟支付结果并开通课程权限' })
  async confirmWechatPayment(@CurrentUser() user: any, @Body() dto: ConfirmPaymentDto, @Req() req: Request) {
    const result = await this.orderService.confirmWechatPayment(user.userId, dto.order_no, resolveClientIp(req));
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
  async payPendingOrder(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const result = await this.orderService.payPendingOrder(user.userId, id, resolveClientIp(req));
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

@ApiTags('微信虚拟支付推送')
@Controller('app/wechat/xpay')
export class WechatXpayNotifyController {
  constructor(private readonly orderService: OrderService) {}

  @Post('notify')
  @ApiOperation({ summary: '微信虚拟支付消息推送（xpay_coin_pay_notify 等）' })
  async notify(@Body() body: Record<string, any>) {
    return this.orderService.handleXpayNotify(body);
  }
}

@ApiTags('订单管理')
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get('list')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取订单列表' })
  async getOrderList(@Query() dto: GetAdminOrderListDto) {
    const result = await this.orderService.getAdminOrderList(dto);
    return CommonResponseDto.success(result);
  }

  @Get(':id')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '获取订单详情' })
  async getOrderDetail(@Param('id', ParseIntPipe) id: number) {
    const result = await this.orderService.getAdminOrderDetail(id);
    return CommonResponseDto.success(result);
  }

  @Post(':id/sync-payment')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '同步微信支付状态（补单）' })
  async syncPaymentStatus(@Param('id', ParseIntPipe) id: number) {
    const result = await this.orderService.syncOrderPaymentStatus(id);
    return CommonResponseDto.success(result);
  }

  @Post(':id/refund')
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiOperation({ summary: '售后订单退款' })
  async refundOrder(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefundOrderDto,
  ) {
    const result = await this.orderService.refundOrder(id, user.userId, dto);
    return CommonResponseDto.success(result);
  }
}
