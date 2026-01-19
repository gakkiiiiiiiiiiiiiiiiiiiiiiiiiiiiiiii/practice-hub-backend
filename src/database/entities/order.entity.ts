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

	@Column()
	course_id: number; // 从 subject_id 改为 course_id

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
