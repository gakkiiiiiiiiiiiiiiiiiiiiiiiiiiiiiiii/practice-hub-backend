import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderAfterSale, AfterSaleStatus } from '../../database/entities/order-after-sale.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { CreateAfterSaleDto } from './dto/create-after-sale.dto';
import { ProcessAfterSaleDto } from './dto/process-after-sale.dto';

@Injectable()
export class AfterSaleService {
  constructor(
    @InjectRepository(OrderAfterSale)
    private afterSaleRepository: Repository<OrderAfterSale>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
  ) {}

  /**
   * 创建售后申请
   */
  async createAfterSale(userId: number, dto: CreateAfterSaleDto) {
    // 检查订单是否存在且属于该用户
    const order = await this.orderRepository.findOne({
      where: { id: dto.order_id, user_id: userId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在或不属于当前用户');
    }

    // 只有已支付的订单才能申请售后
    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException('只有已支付的订单才能申请售后');
    }

    // 检查是否已有待处理的售后申请
    const existing = await this.afterSaleRepository.findOne({
      where: {
        order_id: dto.order_id,
        status: AfterSaleStatus.PENDING,
      },
    });

    if (existing) {
      throw new BadRequestException('该订单已有待处理的售后申请');
    }

    // 创建售后申请
    const afterSale = this.afterSaleRepository.create({
      order_id: dto.order_id,
      user_id: userId,
      reason: dto.reason,
      description: dto.description || '',
      status: AfterSaleStatus.PENDING,
    });

    await this.afterSaleRepository.save(afterSale);

    // 更新订单状态为售后
    order.status = OrderStatus.AFTER_SALE;
    await this.orderRepository.save(order);

    return afterSale;
  }

  /**
   * 获取用户的售后申请列表
   */
  async getUserAfterSaleList(userId: number) {
    const afterSales = await this.afterSaleRepository.find({
      where: { user_id: userId },
      order: { create_time: 'DESC' },
    });

    // 获取订单信息
    const orderIds = afterSales.map((as) => as.order_id);
    const orders = orderIds.length > 0
      ? await this.orderRepository.find({
          where: { id: orderIds as any },
        })
      : [];

    const orderMap = new Map(orders.map((o) => [o.id, o]));

    return afterSales.map((as) => ({
      id: as.id,
      order_id: as.order_id,
      order_no: orderMap.get(as.order_id)?.order_no || '',
      reason: as.reason,
      description: as.description,
      status: as.status,
      admin_reply: as.admin_reply,
      create_time: as.create_time,
      process_time: as.process_time,
    }));
  }

  /**
   * 获取所有售后申请列表（管理后台）
   */
  async getAfterSaleList(status?: number) {
    const where: any = {};
    if (status !== undefined) {
      where.status = status;
    }

    const afterSales = await this.afterSaleRepository.find({
      where,
      order: { create_time: 'DESC' },
    });

    // 获取订单和用户信息
    const orderIds = afterSales.map((as) => as.order_id);
    const orders = orderIds.length > 0
      ? await this.orderRepository.find({
          where: { id: orderIds as any },
        })
      : [];

    const orderMap = new Map(orders.map((o) => [o.id, o]));

    return {
      list: afterSales.map((as) => ({
        id: as.id,
        order_id: as.order_id,
        order_no: orderMap.get(as.order_id)?.order_no || '',
        user_id: as.user_id,
        reason: as.reason,
        description: as.description,
        status: as.status,
        admin_id: as.admin_id,
        admin_reply: as.admin_reply,
        create_time: as.create_time,
        process_time: as.process_time,
        update_time: as.update_time,
      })),
      total,
    };
  }

  /**
   * 处理售后申请（管理后台）
   */
  async processAfterSale(adminId: number, afterSaleId: number, dto: ProcessAfterSaleDto) {
    const afterSale = await this.afterSaleRepository.findOne({
      where: { id: afterSaleId },
    });

    if (!afterSale) {
      throw new NotFoundException('售后申请不存在');
    }

    if (afterSale.status !== AfterSaleStatus.PENDING) {
      throw new BadRequestException('该售后申请已处理');
    }

    // 更新售后申请状态
    afterSale.status = dto.status;
    afterSale.admin_id = adminId;
    afterSale.admin_reply = dto.admin_reply || '';
    afterSale.process_time = new Date();
    await this.afterSaleRepository.save(afterSale);

    // 如果已处理，可以在这里添加退款逻辑
    // TODO: 对接退款接口

    return afterSale;
  }
}
