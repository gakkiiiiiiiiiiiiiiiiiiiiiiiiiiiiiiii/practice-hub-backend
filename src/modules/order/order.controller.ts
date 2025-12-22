import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateOrderDto } from './dto/create-order.dto';

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
}

