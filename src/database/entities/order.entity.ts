import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum OrderStatus {
	PENDING = 'pending', // 待支付
	PAID = 'paid', // 支付完成
	CANCELLED = 'cancelled', // 已取消
	AFTER_SALE = 'after_sale', // 售后
}

export enum OrderDeliveryStatus {
	PENDING = 'pending',
	SHIPPED = 'shipped',
}

export type OrderShippingAddress = {
	name: string;
	phone: string;
	province: string;
	city: string;
	district: string;
	detail: string;
	postalCode?: string;
	nationalCode?: string;
	raw?: Record<string, any>;
};

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

	@Column({ type: 'json', nullable: true, comment: '实物订单收货地址' })
	shipping_address: OrderShippingAddress | null;

	@Column({ type: 'varchar', length: 20, default: OrderDeliveryStatus.PENDING, comment: '实物订单发货状态' })
	delivery_status: OrderDeliveryStatus;

	@Column({ type: 'varchar', length: 80, nullable: true, comment: '物流运单号' })
	tracking_no: string | null;

	@Column({ type: 'varchar', length: 40, nullable: true, comment: '物流公司编码' })
	shipper_code: string | null;

	@Column({ type: 'varchar', length: 80, nullable: true, comment: '物流公司名称' })
	shipper_name: string | null;

	@Column({ type: 'datetime', nullable: true, comment: '发货时间' })
	shipped_at: Date | null;

	@Column({ type: 'varchar', length: 20, nullable: true, comment: '发货操作人类型' })
	ship_operator_type: 'admin' | 'app_admin' | null;

	@Column({ type: 'int', nullable: true, comment: '发货操作人ID' })
	ship_operator_id: number | null;

	@Column({ type: 'varchar', length: 255, nullable: true, comment: '发货备注' })
	shipment_remark: string | null;

	@Column({ type: 'json', nullable: true, comment: '最近一次物流查询快照' })
	logistics_snapshot: Record<string, any> | null;

	@Column({ type: 'datetime', nullable: true })
	paid_time: Date | null;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
