import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PackageSection } from './package-section.entity';

export enum PackagePlanType {
	MONTHLY = 'monthly',
	QUARTERLY = 'quarterly',
	YEARLY = 'yearly',
}

@Entity('package_plan')
export class PackagePlan {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	section_id: number;

	@Column({ type: 'varchar', length: 20 })
	plan_type: PackagePlanType;

	@Column({ length: 50 })
	name: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	price: number;

	@Column({ type: 'int', default: 30 })
	duration_days: number;

	@Column({ type: 'tinyint', default: 1 })
	status: number;

	@Column({ type: 'int', default: 0 })
	sort: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	@ManyToOne(() => PackageSection, (section) => section.plans, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'section_id' })
	section: PackageSection;
}
