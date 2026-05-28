import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_package_subscription')
export class UserPackageSubscription {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	user_id: number;

	@Column()
	section_id: number;

	@Column({ type: 'datetime' })
	expire_time: Date;

	@Column({ nullable: true })
	order_id: number | null;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
