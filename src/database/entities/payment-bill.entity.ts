import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type PaymentBillChannel = "wechat" | "xpay";
export type PaymentBillStatus =
  | "fetching"
  | "pending"
  | "ready"
  | "empty"
  | "failed";

@Entity("payment_bill")
@Index("uq_payment_bill_scope", ["account_key", "channel", "bill_date"], {
  unique: true,
})
export class PaymentBill {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 64, select: false }) account_key: string;
  @Column({ length: 10 }) channel: PaymentBillChannel;
  @Column({ type: "date" }) bill_date: string;
  @Column({ length: 16 }) status: PaymentBillStatus;
  @Column({ type: "longblob", nullable: true, select: false })
  original_gzip: Buffer | null;
  @Column({ type: "int", default: 0 }) original_size: number;
  @Column({ length: 128, nullable: true }) original_filename: string | null;
  @Column({ length: 64, nullable: true }) sha256: string | null;
  @Column({ type: "int", nullable: true }) row_count: number | null;
  @Column({ default: false }) preview_supported: boolean;
  @Column({ length: 500, nullable: true }) notice: string | null;
  @Column({ length: 255, nullable: true }) error_message: string | null;
  @Column({ type: "datetime", nullable: true }) fetched_at: Date | null;
  @Column({ type: "datetime", nullable: true }) retry_after: Date | null;
  @Column({ type: "date", nullable: true, select: false }) attempt_day:
    | string
    | null;
  @Column({ type: "int", default: 0, select: false }) attempt_count: number;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}

/** One row serializes on-demand work across replicas and enforces a persistent daily budget. */
@Entity("payment_bill_control")
export class PaymentBillControl {
  @PrimaryColumn({ type: "int" }) id: number;
  @Column({ type: "varchar", length: 36, nullable: true }) lease_token:
    | string
    | null;
  @Column({ type: "datetime", nullable: true }) lease_until: Date | null;
  @Column({ type: "date", nullable: true }) budget_day: string | null;
  @Column({ type: "int", default: 0 }) attempt_count: number;
}
