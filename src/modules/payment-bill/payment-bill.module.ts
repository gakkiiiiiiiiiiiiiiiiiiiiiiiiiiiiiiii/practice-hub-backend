import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  PaymentBill,
  PaymentBillControl,
} from "../../database/entities/payment-bill.entity";
import { Order } from "../../database/entities/order.entity";
import { SysOperationLog } from "../../database/entities/sys-operation-log.entity";
import { OrderModule } from "../order/order.module";
import {
  BillAdminGuard,
  PaymentBillController,
} from "./payment-bill.controller";
import { PaymentBillGateway } from "./payment-bill.gateway";
import { PaymentBillService } from "./payment-bill.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentBill,
      PaymentBillControl,
      Order,
      SysOperationLog,
    ]),
    OrderModule,
  ],
  controllers: [PaymentBillController],
  providers: [PaymentBillService, PaymentBillGateway, BillAdminGuard],
})
export class PaymentBillModule {}
