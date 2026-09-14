import { ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Order, OrderStatus } from "../../database/entities/order.entity";
import { PendingOrderExpirationService } from "./pending-order-expiration.service";

describe("PendingOrderExpirationService", () => {
  const createService = async (
    enabled = "true",
    dueOrders: Array<Pick<Order, "id">> = [],
  ) => {
    const query = {
      select: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue(dueOrders),
    };
    query.select.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.andWhere.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.addOrderBy.mockReturnValue(query);
    query.take.mockReturnValue(query);
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      update: jest.fn().mockResolvedValue({ affected: dueOrders.length }),
    };
    const module = await Test.createTestingModule({
      providers: [
        PendingOrderExpirationService,
        { provide: getRepositoryToken(Order), useValue: repository },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback: unknown) =>
              key === "ORDER_EXPIRATION_ENABLED" ? enabled : fallback,
            ),
          },
        },
      ],
    }).compile();
    return {
      service: module.get(PendingOrderExpirationService),
      repository,
      query,
      module,
    };
  };

  it("does no database work while the scheduled worker is disabled", async () => {
    const { service, repository, module } = await createService("false");
    await expect(service.handleScheduledExpiration()).resolves.toEqual({
      scanned: 0,
      cancelled: 0,
    });
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    await module.close();
  });

  it("uses one indexed query and no update when the queue is empty", async () => {
    const { service, repository, query, module } = await createService("true");
    const result = await service.handleScheduledExpiration();
    expect(result).toEqual({ scanned: 0, cancelled: 0 });
    expect(query.where).toHaveBeenCalledWith("pendingOrder.status = :status", {
      status: OrderStatus.PENDING,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      "pendingOrder.create_time <= :expiresBefore",
      expect.any(Object),
    );
    expect(repository.update).not.toHaveBeenCalled();
    await module.close();
  });

  it("cancels only the bounded pending batch with a conditional update", async () => {
    const { service, repository, query, module } = await createService("true", [
      { id: 11 },
      { id: 12 },
    ]);
    const result = await service.handleScheduledExpiration();
    expect(result).toEqual({ scanned: 2, cancelled: 2 });
    expect(query.take).toHaveBeenCalledWith(200);
    expect(repository.update).toHaveBeenCalledWith(
      { id: expect.anything(), status: OrderStatus.PENDING },
      { status: OrderStatus.CANCELLED },
    );
    await module.close();
  });
});
