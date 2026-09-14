import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Order, OrderStatus } from "../../database/entities/order.entity";

const PAYMENT_TIMEOUT_MS = 10 * 60_000;

@Injectable()
export class PendingOrderExpirationService {
  private readonly logger = new Logger(PendingOrderExpirationService.name);
  private running = false;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly configService: ConfigService,
  ) {}

  @Cron(process.env.ORDER_EXPIRATION_CRON || "* * * * *")
  async handleScheduledExpiration() {
    const enabled = String(
      this.configService.get("ORDER_EXPIRATION_ENABLED", "false"),
    ).toLowerCase();
    if (!["1", "true", "on", "yes"].includes(enabled)) {
      return { scanned: 0, cancelled: 0 };
    }
    return this.expireDueOrders();
  }

  async expireDueOrders(now = new Date()) {
    if (this.running) return { scanned: 0, cancelled: 0 };
    this.running = true;
    try {
      const configuredLimit = Number(
        this.configService.get("ORDER_EXPIRATION_BATCH_SIZE", 200),
      );
      const batchSize = Math.min(
        1000,
        Math.max(1, Number.isFinite(configuredLimit) ? configuredLimit : 200),
      );
      const dueOrders = await this.orderRepository
        .createQueryBuilder("pendingOrder")
        .select(["pendingOrder.id"])
        .where("pendingOrder.status = :status", { status: OrderStatus.PENDING })
        .andWhere("pendingOrder.create_time <= :expiresBefore", {
          expiresBefore: new Date(now.getTime() - PAYMENT_TIMEOUT_MS),
        })
        .orderBy("pendingOrder.create_time", "ASC")
        .addOrderBy("pendingOrder.id", "ASC")
        .take(batchSize)
        .getMany();

      if (dueOrders.length === 0) {
        this.logger.debug("待支付订单过期任务: scanned=0, cancelled=0");
        return { scanned: 0, cancelled: 0 };
      }

      const result = await this.orderRepository.update(
        {
          id: In(dueOrders.map((order) => order.id)),
          status: OrderStatus.PENDING,
        },
        { status: OrderStatus.CANCELLED },
      );
      const cancelled = Number(result.affected || 0);
      this.logger.log(
        `待支付订单过期任务: scanned=${dueOrders.length}, cancelled=${cancelled}`,
      );
      return { scanned: dueOrders.length, cancelled };
    } finally {
      this.running = false;
    }
  }
}
