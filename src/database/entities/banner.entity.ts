import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('banner')
export class Banner {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 500, comment: '轮播图图片URL' })
	image: string;

	@Column({ length: 500, nullable: true, comment: '跳转链接（可选）' })
	link: string;

	@Column({ length: 100, nullable: true, comment: '标题（可选）' })
	title: string;

	@Column({ type: 'int', default: 0, comment: '排序号，数字越小越靠前' })
	sort_order: number;

	@Column({ type: 'tinyint', default: 1, comment: '状态（0-禁用，1-启用）' })
	status: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
