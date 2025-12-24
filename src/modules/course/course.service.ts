import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';

@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
  ) {}

  /**
   * 获取所有课程列表
   */
  async getAllCourses(keyword?: string) {
    const queryBuilder = this.courseRepository.createQueryBuilder('course');

    if (keyword) {
      queryBuilder.where(
        '(course.name LIKE :keyword OR course.subject LIKE :keyword OR course.school LIKE :keyword OR course.major LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    return await queryBuilder.orderBy('course.sort', 'ASC').getMany();
  }

  /**
   * 获取课程详情
   */
  async getCourseDetail(courseId: number, userId?: number) {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      relations: ['chapters'],
    });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    // 获取章节列表
    const chapters = await this.chapterRepository.find({
      where: { course_id: courseId },
      order: { sort: 'ASC' },
      relations: ['course'],
    });

    // 检查用户是否有权限（如果提供了 userId）
    let hasAuth = false;
    if (userId) {
      const auth = await this.userCourseAuthRepository.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
        },
      });
      hasAuth = !!auth && (!auth.expire_time || auth.expire_time > new Date());
    }

    return {
      ...course,
      chapters,
      hasAuth,
    };
  }
}

