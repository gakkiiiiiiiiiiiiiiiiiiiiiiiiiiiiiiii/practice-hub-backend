import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('user_category_bundle_access')
@Index('idx_user_category_bundle_access_user_category', [
  'user_id',
  'category_id',
])
@Index('uk_user_category_bundle_access_order', ['order_id'], { unique: true })
@Index('uk_user_category_bundle_access_activation_code', ['activation_code_id'], { unique: true })
export class UserCategoryBundleAccess {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  category_id: number;

  @Column({ nullable: true })
  order_id: number | null;

  @Column({ nullable: true })
  activation_code_id: number | null;

  @CreateDateColumn()
  create_time: Date;
}
