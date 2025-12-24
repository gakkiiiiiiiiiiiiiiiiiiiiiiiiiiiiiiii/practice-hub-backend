import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { HomeRecommendCategory } from './home-recommend-category.entity';

@Entity('home_recommend_item')
export class HomeRecommendItem {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	category_id: number;

	@Column()
	course_id: number; // 从 subject_id 改为 course_id

	@Column({ type: 'int', default: 0 })
	sort: number; // 版块内排序

	@CreateDateColumn()
	create_time: Date;

	@ManyToOne(() => HomeRecommendCategory, (category) => category.items)
	@JoinColumn({ name: 'category_id' })
	category: HomeRecommendCategory;
}
