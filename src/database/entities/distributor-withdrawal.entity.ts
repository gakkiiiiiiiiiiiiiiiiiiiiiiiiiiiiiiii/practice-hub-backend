import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum DistributorWithdrawalStatus {
	PENDING = 0,
	PAID = 1,
	REJECTED = 2,
}

@Entity('distributor_withdrawal')
@Index(['distributor_id', 'status'])
export class DistributorWithdrawal {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int' })
	distributor_id: number;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	amount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	fee_amount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	payout_amount: number;

	@Column({ type: 'varchar', length: 120 })
	alipay_account: string;

	@Column({ type: 'varchar', length: 50 })
	real_name: string;

	@Column({ type: 'tinyint', default: DistributorWithdrawalStatus.PENDING })
	status: DistributorWithdrawalStatus;

	@Column({ type: 'varchar', length: 255, nullable: true })
	remark: string | null;

	@Column({ type: 'int', nullable: true })
	admin_id: number | null;

	@Column({ type: 'datetime', nullable: true })
	processed_at: Date | null;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
