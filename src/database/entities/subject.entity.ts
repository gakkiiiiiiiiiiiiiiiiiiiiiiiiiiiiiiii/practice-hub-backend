import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Chapter } from './chapter.entity';

@Entity('subject')
export class Subject {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 500, nullable: true })
  cover_img: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  @Column({ type: 'tinyint', default: 0 })
  is_vip_free: number; // 0-否, 1-是

  @Column({ type: 'int', default: 0 })
  student_count: number;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;

  @OneToMany(() => Chapter, (chapter) => chapter.subject)
  chapters: Chapter[];
}

