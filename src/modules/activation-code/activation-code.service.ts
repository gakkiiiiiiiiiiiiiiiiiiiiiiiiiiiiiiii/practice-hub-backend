import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ActivationCode, ActivationCodeStatus } from '../../database/entities/activation-code.entity';
import { UserSubjectAuth, AuthSource } from '../../database/entities/user-subject-auth.entity';

@Injectable()
export class ActivationCodeService {
  constructor(
    @InjectRepository(ActivationCode)
    private activationCodeRepository: Repository<ActivationCode>,
    @InjectRepository(UserSubjectAuth)
    private userSubjectAuthRepository: Repository<UserSubjectAuth>,
    private dataSource: DataSource,
  ) {}

  /**
   * 激活码核销（并发安全）
   */
  async redeemCode(userId: number, code: string) {
    // 开启事务
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. 查询激活码
      const activationCode = await queryRunner.manager.findOne(ActivationCode, {
        where: { code, status: ActivationCodeStatus.PENDING },
      });

      if (!activationCode) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException('激活码无效或已使用');
      }

      // 2. 使用乐观锁更新状态
      const updateResult = await queryRunner.manager.update(
        ActivationCode,
        { code, status: ActivationCodeStatus.PENDING },
        {
          status: ActivationCodeStatus.USED,
          used_by_uid: userId,
          used_time: new Date(),
        },
      );

      // 3. 判断影响行数
      if (updateResult.affected === 0) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException('激活码已被使用，请重试');
      }

      // 4. 给用户添加题库权限
      const existingAuth = await queryRunner.manager.findOne(UserSubjectAuth, {
        where: {
          user_id: userId,
          subject_id: activationCode.subject_id,
        },
      });

      if (!existingAuth) {
        await queryRunner.manager.save(UserSubjectAuth, {
          user_id: userId,
          subject_id: activationCode.subject_id,
          source: AuthSource.CODE,
          expire_time: null, // 激活码通常永久有效
        });
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        subject_id: activationCode.subject_id,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

