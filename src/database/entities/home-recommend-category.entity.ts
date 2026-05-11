import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { HomeRecommendItem } from './home-recommend-item.entity';

@Entity('home_recommend_category')
export class HomeRecommendCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string; // 版块名称

  @Column({ type: 'varchar', length: 20, default: 'course' })
  type: 'course' | 'category'; // course-课程板块，category-分类板块

  @Column({ type: 'int', nullable: true })
  bind_category_id: number | null; // 分类板块绑定的一级分类ID

  @Column({ type: 'int', default: 0 })
  sort: number; // 排序权重

  @Column({ type: 'int', default: 3 })
  columns: number; // 小程序端每行显示列数

  @Column({ type: 'tinyint', default: 1 })
  status: number; // 0-隐藏, 1-显示

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;

  @OneToMany(() => HomeRecommendItem, (item) => item.category)
  items: HomeRecommendItem[];
}
