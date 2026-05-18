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
  vip_expire_time: Date;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
