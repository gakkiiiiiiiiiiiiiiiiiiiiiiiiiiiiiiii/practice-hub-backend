import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PackageSection } from './package-section.entity';

export enum PackageScopeType {
	COURSE = 'course',
	CATEGORY = 'category',
	SUB_CATEGORY = 'sub_category',
	/** VIP：订阅后可查看全站全部启用课程 */
	ALL = 'all',
}

@Entity('package_section_scope')
export class PackageSectionScope {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	section_id: number;

	@Column({ type: 'varchar', length: 20 })
	scope_type: PackageScopeType;

	@Column({ length: 100 })
	scope_value: string;

	@CreateDateColumn()
	create_time: Date;

	@ManyToOne(() => PackageSection, (section) => section.scopes, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'section_id' })
	section: PackageSection;
}
