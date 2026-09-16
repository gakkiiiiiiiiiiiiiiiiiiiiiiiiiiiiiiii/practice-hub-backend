import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('distribution_config')
export class DistributionConfig {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', default: 3, comment: '最大层级数（最多支持几级分销）' })
	max_level: number;

	@Column({ type: 'json', comment: '各级分成比例配置，如：[10, 5, 2] 表示1级10%，2级5%，3级2%' })
	commission_rates: number[];

	@Column({ type: 'json', nullable: true, comment: '初中高三级基础佣金比例' })
	base_commission_rates: number[] | null;

	@Column({ type: 'json', nullable: true, comment: '初中高三级直推团队佣金比例' })
	direct_commission_rates: number[] | null;

	@Column({ type: 'json', nullable: true, comment: '初中高三级间推团队佣金比例' })
	indirect_commission_rates: number[] | null;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0, comment: '最低提现金额（元）' })
	min_withdraw_amount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 20, comment: '提现后最低保留余额（元）' })
	withdraw_reserve_amount: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, default: 5, comment: '提现手续费比例（百分比）' })
	withdraw_fee_rate: number;

	@Column({ type: 'int', default: 15, comment: '佣金冻结天数' })
	commission_freeze_days: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 1, comment: '每种纸质资料固定佣金（元）' })
	paper_commission_per_kind: number;

	@Column({ type: 'tinyint', default: 1, comment: '是否启用分销系统：0-禁用, 1-启用' })
	is_enabled: number;

	@Column({ type: 'text', nullable: true, comment: '分销说明' })
	description: string;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
