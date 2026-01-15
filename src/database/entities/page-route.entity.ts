import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('page_route')
export class PageRoute {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 500, unique: true, comment: '页面路径（如：/pages/index/index）' })
	path: string;

	@Column({ length: 100, comment: '页面标题（如：首页）' })
	title: string;

	@Column({ length: 50, nullable: true, comment: '页面类型（main-主包，sub-子包，tabBar-tabBar页面）' })
	type: string;

	@Column({ type: 'tinyint', default: 1, comment: '状态（0-禁用，1-启用）' })
	status: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
