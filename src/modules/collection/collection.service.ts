import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCollection } from '../../database/entities/user-collection.entity';

@Injectable()
export class CollectionService {
  constructor(
    @InjectRepository(UserCollection)
    private collectionRepository: Repository<UserCollection>,
  ) {}

  /**
   * 收藏/取消收藏
   */
  async toggleCollection(userId: number, questionId: number) {
    const existing = await this.collectionRepository.findOne({
      where: { user_id: userId, question_id: questionId },
    });

    if (existing) {
      // 取消收藏
      await this.collectionRepository.remove(existing);
      return { is_collected: false };
    } else {
      // 添加收藏
      const collection = this.collectionRepository.create({
        user_id: userId,
        question_id: questionId,
      });
      await this.collectionRepository.save(collection);
      return { is_collected: true };
    }
  }
}

