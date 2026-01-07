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

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0, comment: '最低提现金额（元）' })
	min_withdraw_amount: number;

	@Column({ type: 'tinyint', default: 1, comment: '是否启用分销系统：0-禁用, 1-启用' })
	is_enabled: number;

	@Column({ type: 'text', nullable: true, comment: '分销说明' })
	description: string;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}

