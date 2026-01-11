import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Course } from '../../database/entities/course.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { DistributorService } from '../distributor/distributor.service';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @Inject(forwardRef(() => DistributorService))
    private distributorService: DistributorService,
  ) {}

  /**
   * 创建预支付订单
   */
  async createOrder(userId: number, dto: CreateOrderDto) {
    const course = await this.courseRepository.findOne({ where: { id: dto.course_id } });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    // 生成订单号
    const orderNo = this.generateOrderNo();

    // 创建订单
    const order = this.orderRepository.create({
      order_no: orderNo,
      user_id: userId,
      course_id: dto.course_id,
      amount: course.price,
      status: OrderStatus.PENDING,
    });

    await this.orderRepository.save(order);

    // TODO: 对接微信支付 V3，生成预支付订单
    // 这里返回订单信息，实际支付参数需要对接微信支付

    return {
      order_no: order.order_no,
      amount: order.amount,
      course_id: order.course_id,
      // 微信支付参数（需要对接）
      payment_params: {
        // timeStamp, nonceStr, package, signType, paySign
      },
    };
  }

  /**
   * 生成订单号
   */
  private generateOrderNo(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `ORDER${timestamp}${random}`;
  }

  /**
   * 订单支付成功回调（需要对接微信支付回调时调用）
   */
  async handlePaymentSuccess(orderId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    // 更新订单状态为已支付
    order.status = OrderStatus.PAID;
    await this.orderRepository.save(order);

    // 处理分销分成
    try {
      await this.distributorService.processOrderCommission(orderId);
    } catch (error) {
      // 分成失败不影响订单状态，只记录日志
      console.error('订单分成处理失败:', error.message);
    }

    return { message: '订单支付成功' };
  }

  /**
   * 获取订单统计数量
   */
  async getOrderCounts(userId: number) {
    const [pendingCount, paidCount, refundCount] = await Promise.all([
      this.orderRepository.count({
        where: {
          user_id: userId,
          status: OrderStatus.PENDING,
        },
      }),
      this.orderRepository.count({
        where: {
          user_id: userId,
          status: OrderStatus.PAID,
        },
      }),
      this.orderRepository.count({
        where: {
          user_id: userId,
          status: OrderStatus.REFUNDED,
        },
      }),
    ]);

    return {
      pending: pendingCount,
      paid: paidCount,
      refund: refundCount,
    };
  }
}

