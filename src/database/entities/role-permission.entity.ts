import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	ManyToOne,
	JoinColumn,
	CreateDateColumn,
} from 'typeorm';
import { Role } from './role.entity';

@Entity('sys_role_permission')
export class RolePermission {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', comment: '角色ID' })
	role_id: number;

	@Column({ length: 100, comment: '权限标识（如：dashboard:view, question:create）' })
	permission: string;

	@CreateDateColumn()
	create_time: Date;

	@ManyToOne(() => Role, (role) => role.permissions, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'role_id' })
	role: Role;
}
