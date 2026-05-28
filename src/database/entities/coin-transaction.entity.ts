import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum CoinTransactionType {
  RECHARGE = 'recharge',
  PURCHASE = 'purchase',
  ADJUST = 'adjust',
}

@Entity('coin_transaction')
export class CoinTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column({ type: 'varchar', length: 30 })
  type: CoinTransactionType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  balance_after: number;

  @Column({ nullable: true })
  order_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark: string | null;

  @CreateDateColumn()
  create_time: Date;
}
