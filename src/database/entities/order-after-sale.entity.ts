import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AfterSaleStatus {
  PENDING = 0, // 待处理
  PROCESSED = 1, // 已处理
  REJECTED = 2, // 已拒绝
}

@Entity('order_after_sale')
export class OrderAfterSale {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  order_id: number;

  @Column()
  user_id: number;

  @Column({ length: 500 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'tinyint',
    default: AfterSaleStatus.PENDING,
  })
  status: AfterSaleStatus;

  @Column({ nullable: true })
  admin_id: number;

  @Column({ type: 'text', nullable: true })
  admin_reply: string;

  @Column({ nullable: true })
  process_time: Date;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
