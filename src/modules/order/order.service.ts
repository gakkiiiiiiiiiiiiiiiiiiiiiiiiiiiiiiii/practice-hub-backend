import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Subject } from '../../database/entities/subject.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
  ) {}

  /**
   * 创建预支付订单
   */
  async createOrder(userId: number, dto: CreateOrderDto) {
    const subject = await this.subjectRepository.findOne({ where: { id: dto.subject_id } });

    if (!subject) {
      throw new NotFoundException('题库不存在');
    }

    // 生成订单号
    const orderNo = this.generateOrderNo();

    // 创建订单
    const order = this.orderRepository.create({
      order_no: orderNo,
      user_id: userId,
      subject_id: dto.subject_id,
      amount: subject.price,
      status: OrderStatus.PENDING,
    });

    await this.orderRepository.save(order);

    // TODO: 对接微信支付 V3，生成预支付订单
    // 这里返回订单信息，实际支付参数需要对接微信支付

    return {
      order_no: order.order_no,
      amount: order.amount,
      subject_id: order.subject_id,
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
}

