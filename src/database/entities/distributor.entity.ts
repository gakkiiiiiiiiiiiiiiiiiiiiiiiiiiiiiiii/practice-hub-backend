import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { AppUser } from './app-user.entity';

@Entity('distributor')
export class Distributor {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', unique: true, comment: '用户ID' })
	user_id: number;

	@OneToOne(() => AppUser)
	@JoinColumn({ name: 'user_id' })
	user: AppUser;

	@Column({
		type: 'varchar',
		length: 50,
		unique: true,
		comment: '分销商编号（唯一标识）',
	})
	distributor_code: string;

	@Column({
		type: 'varchar',
		length: 200,
		nullable: true,
		comment: '专属二维码URL',
	})
	qr_code_url: string;

	@Column({
		type: 'tinyint',
		default: 0,
		comment: '小程序二维码版本，头像更新后按版本重新生成',
	})
	qr_code_version: number;

	@Column({
		type: 'varchar',
		length: 512,
		nullable: true,
		comment: '专属小程序短链接',
	})
	short_link: string;

	@Column({
		type: 'tinyint',
		default: 0,
		comment: '状态：0-待审核, 1-已通过, 2-已拒绝, 3-已禁用',
	})
	status: number;

	@Column({
		type: 'tinyint',
		default: 1,
		comment: '代理商等级：1-一级代理, 2-二级代理, 3-三级代理',
	})
	agent_level: number;

	@Column({ type: 'text', nullable: true, comment: '拒绝原因' })
	reject_reason: string;

	@Column({
		type: 'decimal',
		precision: 10,
		scale: 2,
		default: 0,
		comment: '累计收益（元）',
	})
	total_earnings: number;

	@Column({
		type: 'decimal',
		precision: 10,
		scale: 2,
		default: 0,
		comment: '可提现金额（元）',
	})
	withdrawable_amount: number;

	@Column({
		type: 'decimal',
		precision: 10,
		scale: 2,
		default: 0,
		comment: '冻结中佣金（元）',
	})
	frozen_amount: number;

	@Column({
		type: 'decimal',
		precision: 10,
		scale: 2,
		default: 0,
		comment: '退款产生、待后续佣金抵扣的欠款（元）',
	})
	commission_debt_amount: number;

	@Column({
		type: 'varchar',
		length: 120,
		nullable: true,
		comment: '提现支付宝账号',
	})
	alipay_account: string | null;

	@Column({ type: 'varchar', length: 50, nullable: true, comment: '提现实名' })
	real_name: string | null;

	@Column({ type: 'int', default: 0, comment: '下级用户数量' })
	subordinate_count: number;

	@Column({ type: 'int', default: 0, comment: '累计推广订单数' })
	total_orders: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
