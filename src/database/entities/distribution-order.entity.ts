import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	Index,
} from 'typeorm';

@Entity('distribution_order')
@Index(['order_id']) // 用于查询订单的分成记录
@Index(['distributor_id', 'status']) // 用于查询分销商的收益
export class DistributionOrder {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', comment: '订单ID' })
	order_id: number;

	@Column({ type: 'int', comment: '分销商ID（获得分成的分销商）' })
	distributor_id: number;

	@Column({ type: 'int', comment: '购买用户ID' })
	buyer_id: number;

	@Column({ type: 'int', comment: '层级（1级、2级、3级等）' })
	level: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, comment: '订单金额（元）' })
	order_amount: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '分成比例（百分比，如 10.5 表示 10.5%）' })
	commission_rate: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, comment: '分成金额（元）' })
	commission_amount: number;

	@Column({ type: 'tinyint', default: 0, comment: '状态：0-待结算, 1-已结算, 2-已取消' })
	status: number;

	@Column({ type: 'datetime', nullable: true, comment: '结算时间' })
	settle_time: Date;

	@CreateDateColumn()
	create_time: Date;
}

