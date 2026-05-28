import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { PackageSectionScope } from './package-section-scope.entity';
import { PackagePlan } from './package-plan.entity';

@Entity('package_section')
export class PackageSection {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 100 })
	name: string;

	@Column({ type: 'text', nullable: true })
	description: string | null;

	@Column({ length: 500, nullable: true })
	cover_img: string | null;

	@Column({ type: 'json', nullable: true })
	cover_style: {
		backgroundColor?: string;
		titleColor?: string;
		categoriesColor?: string;
	} | null;

	@Column({ type: 'tinyint', default: 1 })
	status: number;

	@Column({ type: 'int', default: 0 })
	sort: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	@OneToMany(() => PackageSectionScope, (scope) => scope.section)
	scopes: PackageSectionScope[];

	@OneToMany(() => PackagePlan, (plan) => plan.section)
	plans: PackagePlan[];
}
