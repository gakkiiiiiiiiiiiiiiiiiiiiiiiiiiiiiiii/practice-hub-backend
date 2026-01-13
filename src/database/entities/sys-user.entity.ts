import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
} from 'typeorm';
import { Role } from './role.entity';

export enum AdminRole {
	SUPER_ADMIN = 'super_admin',
	CONTENT_ADMIN = 'content_admin',
	AGENT = 'agent',
}

@Entity('sys_user')
export class SysUser {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 50, unique: true })
	username: string;

	@Column({ length: 255 })
	password: string;

	@Column({
		type: 'enum',
		enum: AdminRole,
		default: AdminRole.CONTENT_ADMIN,
		comment: '角色枚举（保留用于兼容，实际使用 role_id）',
	})
	role: AdminRole;

	@Column({ type: 'int', nullable: true, comment: '角色ID（关联 sys_role 表）' })
	role_id: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	balance: number;

	@Column({ type: 'tinyint', default: 1 })
	status: number; // 0-禁用, 1-启用

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	// 关联角色实体
	@ManyToOne(() => Role, { nullable: true })
	@JoinColumn({ name: 'role_id' })
	roleEntity: Role;
}

