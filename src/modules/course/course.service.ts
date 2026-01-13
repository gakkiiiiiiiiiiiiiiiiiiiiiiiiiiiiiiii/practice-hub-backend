import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { CourseRecommendation } from '../../database/entities/course-recommendation.entity';

@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    @InjectRepository(CourseRecommendation)
    private courseRecommendationRepository: Repository<CourseRecommendation>,
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

    // 检查用户是否有权限
    let hasAuth = false;
    
    // 免费课程，直接有权限
    const price = Number(course.price) || 0;
    const isFree = course.is_free === 1;
    if (price === 0 || isFree) {
      hasAuth = true;
    } else if (userId) {
      // 付费课程，检查用户权限
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

  /**
   * 获取课程相关推荐
   * 优先使用课程级别的配置，如果没有则使用公共配置
   */
  async getRecommendations(courseId?: number) {
    // 先查找课程级别的配置
    let recommendation = await this.courseRecommendationRepository.findOne({
      where: { course_id: courseId || null },
    });

    // 如果没有课程级别的配置，查找公共配置
    if (!recommendation) {
      recommendation = await this.courseRecommendationRepository.findOne({
        where: { course_id: null },
      });
    }

    // 如果没有配置，返回空数组
    if (!recommendation || !recommendation.recommended_course_ids || recommendation.recommended_course_ids.length === 0) {
      return [];
    }

    // 获取推荐的课程详情
    const recommendedCourses = await this.courseRepository.find({
      where: { id: In(recommendation.recommended_course_ids) },
      order: { sort: 'ASC' },
    });

    return recommendedCourses;
  }
}

