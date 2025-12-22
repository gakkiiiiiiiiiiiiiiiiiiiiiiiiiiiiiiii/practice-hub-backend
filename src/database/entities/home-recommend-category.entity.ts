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

  @Column({ type: 'int', default: 0 })
  sort: number; // 排序权重

  @Column({ type: 'tinyint', default: 1 })
  status: number; // 0-隐藏, 1-显示

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;

  @OneToMany(() => HomeRecommendItem, (item) => item.category)
  items: HomeRecommendItem[];
}

