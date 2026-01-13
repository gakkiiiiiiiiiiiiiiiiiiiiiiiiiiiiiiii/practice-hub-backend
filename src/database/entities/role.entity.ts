import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	OneToMany,
} from 'typeorm';
import { RolePermission } from './role-permission.entity';
import { SysUser } from './sys-user.entity';

@Entity('sys_role')
export class Role {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 50, unique: true, comment: '角色标识（如：agent, content_admin）' })
	value: string;

	@Column({ length: 50, comment: '角色名称（如：代理商、题库管理员）' })
	name: string;

	@Column({ type: 'text', nullable: true, comment: '角色描述' })
	description: string;

	@Column({ type: 'tinyint', default: 0, comment: '是否系统角色（0-否，1-是），系统角色不能删除' })
	is_system: number;

	@Column({ type: 'tinyint', default: 1, comment: '状态（0-禁用，1-启用）' })
	status: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	// 关联权限
	@OneToMany(() => RolePermission, (rolePermission) => rolePermission.role)
	permissions: RolePermission[];

	// 关联用户
	@OneToMany(() => SysUser, (user) => user.roleEntity)
	users: SysUser[];
}
