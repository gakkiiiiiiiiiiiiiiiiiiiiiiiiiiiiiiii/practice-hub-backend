import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum UserCouponStatus {
	UNUSED = 'unused',
	USED = 'used',
	EXPIRED = 'expired',
}

@Entity('user_coupon')
export class UserCoupon {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	user_id: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	amount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	min_amount: number;

	@Column({ type: 'varchar', length: 20, default: UserCouponStatus.UNUSED })
	status: UserCouponStatus;

	@Column({ type: 'varchar', length: 30, default: 'referral' })
	source: string;

	@Column({ nullable: true })
	used_order_id: number | null;

	@Column({ type: 'datetime', nullable: true })
	expire_time: Date | null;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
