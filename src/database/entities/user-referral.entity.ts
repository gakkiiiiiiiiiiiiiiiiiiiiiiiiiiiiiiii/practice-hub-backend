import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('user_referral')
export class UserReferral {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	inviter_user_id: number;

	@Column({ unique: true })
	invitee_user_id: number;

	@CreateDateColumn()
	create_time: Date;
}
