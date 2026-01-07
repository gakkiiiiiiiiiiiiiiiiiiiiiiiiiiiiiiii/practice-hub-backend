import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	Index,
} from 'typeorm';

@Entity('distribution_relation')
@Index(['user_id'], { unique: true }) // 每个用户只能有一个上级
@Index(['distributor_id', 'level']) // 用于查询某个分销商的下级
export class DistributionRelation {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', comment: '用户ID（下级）' })
	user_id: number;

	@Column({ type: 'int', comment: '分销商ID（上级）' })
	distributor_id: number;

	@Column({ type: 'int', comment: '层级（1级、2级、3级等）' })
	level: number;

	@Column({ type: 'varchar', length: 50, nullable: true, comment: '注册来源（分销商编号）' })
	source_code: string;

	@CreateDateColumn()
	create_time: Date;
}

