import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Course } from './course.entity';

@Entity('course_file')
@Index(['course_id', 'sort'])
export class CourseFile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  course_id: number;

  @Column({ length: 255, comment: '展示名称（可自定义）' })
  display_name: string;

  @Column({ type: 'varchar', length: 500 })
  file_url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  file_name: string | null;

  @Column({ type: 'varchar', length: 20 })
  file_type: string;

  @Column({ type: 'bigint', default: 0 })
  file_size: number;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'int', nullable: true, comment: 'PDF 总页数缓存' })
  file_page_count: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true, comment: '页数缓存对应的文件版本' })
  file_page_count_key: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '0-禁用，1-启用' })
  status: number;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_id' })
  course: Course;
}
