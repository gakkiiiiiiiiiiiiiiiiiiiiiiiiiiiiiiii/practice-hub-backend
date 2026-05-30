import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AppUserRole {
  USER = 'user',
  BANK_ADMIN = 'bank_admin',
  ADMIN = 'admin',
}

@Entity('app_user')
export class AppUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  openid: string;

  @Column({ length: 50, unique: true, nullable: true })
  username: string;

  @Column({ length: 255, nullable: true })
  password_hash: string;

  @Column({ length: 255, nullable: true })
  session_key: string;

  @Column({ length: 100, nullable: true })
  nickname: string;

  @Column({ length: 500, nullable: true })
  avatar: string;

  @Column({ length: 20, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 20, default: AppUserRole.USER })
  role: AppUserRole;

  @Column({ type: 'datetime', nullable: true })
  package_expire_time: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, comment: '微信代币余额缓存' })
  coin_balance: number;

  @Column({ type: 'int', default: 0, comment: '积分余额' })
  points_balance: number;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
