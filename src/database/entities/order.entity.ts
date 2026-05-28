import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum OrderStatus {
	PENDING = 'pending', // 待支付
	PAID = 'paid', // 支付完成
	CANCELLED = 'cancelled', // 已取消
	AFTER_SALE = 'after_sale', // 售后
}

@Entity('order')
export class Order {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 50, unique: true })
	order_no: string;

	@Column()
	user_id: number;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	amount: number;

	@Column({
		type: 'enum',
		enum: OrderStatus,
		default: OrderStatus.PENDING,
	})
	status: OrderStatus;

	@Column({ nullable: true })
	course_id: number | null;

	@Column({ type: 'varchar', length: 20, default: 'course' })
	order_type: 'course' | 'package';

	@Column({ nullable: true })
	package_section_id: number | null;

	@Column({ nullable: true })
	package_plan_id: number | null;

	@Column({ nullable: true })
	coupon_id: number | null;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	discount_amount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
	original_amount: number | null;

	@Column({ length: 30, nullable: true })
	pay_provider: string | null;

	@Column({ type: 'json', nullable: true })
	pay_payload: Record<string, any> | null;

	@Column({ type: 'datetime', nullable: true })
	paid_time: Date | null;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
