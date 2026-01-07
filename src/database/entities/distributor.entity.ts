import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	OneToOne,
	JoinColumn,
} from 'typeorm';
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

	@Column({ type: 'varchar', length: 50, unique: true, comment: '分销商编号（唯一标识）' })
	distributor_code: string;

	@Column({ type: 'varchar', length: 200, nullable: true, comment: '专属二维码URL' })
	qr_code_url: string;

	@Column({ type: 'tinyint', default: 0, comment: '状态：0-待审核, 1-已通过, 2-已拒绝, 3-已禁用' })
	status: number;

	@Column({ type: 'text', nullable: true, comment: '拒绝原因' })
	reject_reason: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0, comment: '累计收益（元）' })
	total_earnings: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0, comment: '可提现金额（元）' })
	withdrawable_amount: number;

	@Column({ type: 'int', default: 0, comment: '下级用户数量' })
	subordinate_count: number;

	@Column({ type: 'int', default: 0, comment: '累计推广订单数' })
	total_orders: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}

