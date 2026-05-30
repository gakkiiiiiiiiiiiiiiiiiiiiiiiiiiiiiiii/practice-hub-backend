import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum UserPointsLogType {
	CHECKIN = 'checkin',
	EXCHANGE = 'exchange',
	ADJUST = 'adjust',
}

@Entity('user_points_log')
@Index(['userId', 'createTime'])
export class UserPointsLog {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ name: 'user_id' })
	userId: number;

	@Column({ name: 'change_amount', type: 'int' })
	changeAmount: number;

	@Column({ name: 'balance_after', type: 'int' })
	balanceAfter: number;

	@Column({ type: 'varchar', length: 30 })
	type: UserPointsLogType;

	@Column({ type: 'varchar', length: 255, nullable: true })
	remark: string | null;

	@CreateDateColumn({ name: 'create_time' })
	createTime: Date;
}
