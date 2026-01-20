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
  async getAllCourses(keyword?: string, category?: string, subCategory?: string, sortBy?: string) {
    const queryBuilder = this.courseRepository.createQueryBuilder('course');

    // 关键词搜索
    if (keyword) {
      queryBuilder.where(
        '(course.name LIKE :keyword OR course.subject LIKE :keyword OR course.school LIKE :keyword OR course.major LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    // 分类筛选
    if (category) {
      if (keyword) {
        queryBuilder.andWhere('course.category = :category', { category });
      } else {
        queryBuilder.where('course.category = :category', { category });
      }
    }

    // 二级分类筛选
    if (subCategory) {
      if (keyword || category) {
        queryBuilder.andWhere('course.sub_category = :subCategory', { subCategory });
      } else {
        queryBuilder.where('course.sub_category = :subCategory', { subCategory });
      }
    }

    // 排序
    if (sortBy === 'sales') {
      // 按学习人数排序（销量优先）
      queryBuilder.orderBy('course.student_count', 'DESC');
    } else if (sortBy === 'latest') {
      // 按创建时间排序（最新题库）
      queryBuilder.orderBy('course.create_time', 'DESC');
    } else if (sortBy === 'price_asc') {
      // 按价格升序
      queryBuilder.orderBy('course.price', 'ASC');
    } else if (sortBy === 'price_desc') {
      // 按价格降序
      queryBuilder.orderBy('course.price', 'DESC');
    } else {
      // 默认按排序字段排序（综合排序）
      queryBuilder.orderBy('course.sort', 'ASC');
    }

    return await queryBuilder.getMany();
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
    let expireTime: Date | null = null;
    
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
      if (auth) {
        hasAuth = !auth.expire_time || auth.expire_time > new Date();
        expireTime = auth.expire_time;
      }
    }

    return {
      ...course,
      chapters,
      hasAuth,
      expireTime,
    };
  }

  /**
   * 获取课程相关推荐
   * 优先使用课程级别的配置（course.recommended_course_ids），如果没有则使用公共配置（course_recommendation）
   * 如果都没有配置，返回默认推荐（排除当前课程的其他课程）
   * @param courseId 当前课程ID（可选）
   * @param userId 用户ID（可选，用于获取用户的课程权限和到期时间）
   */
  async getRecommendations(courseId?: number, userId?: number) {
    let recommendedCourseIds: number[] = [];
    
    if (courseId !== undefined && courseId !== null) {
      const numValue = typeof courseId === 'number' ? courseId : Number(courseId);
      if (Number.isFinite(numValue) && !isNaN(numValue) && numValue > 0) {
        // 先查找课程级别的配置（存储在 course 表中）
        const course = await this.courseRepository.findOne({
          where: { id: numValue },
          select: ['id', 'recommended_course_ids'],
        });
        
        if (course && course.recommended_course_ids && course.recommended_course_ids.length > 0) {
          recommendedCourseIds = course.recommended_course_ids;
        }
      }
    }
    
    // 如果没有课程级别的配置，查找公共配置（course_recommendation 表）
    if (recommendedCourseIds.length === 0) {
      // 使用 find 方法获取第一条记录，因为 findOne 需要 where 条件
      const recommendations = await this.courseRecommendationRepository.find({
        order: { id: 'ASC' },
        take: 1, // 只取第一条记录
      });
      
      const recommendation = recommendations.length > 0 ? recommendations[0] : null;
      
      if (recommendation && recommendation.recommended_course_ids && recommendation.recommended_course_ids.length > 0) {
        recommendedCourseIds = recommendation.recommended_course_ids;
      }
    }

    // 如果有配置的推荐课程ID，返回这些课程
    let recommendedCourses = [];
    if (recommendedCourseIds.length > 0) {
      recommendedCourses = await this.courseRepository.find({
        where: { id: In(recommendedCourseIds) },
        order: { sort: 'ASC' },
      });
    } else {
      // 如果没有配置或配置为空，返回默认推荐（排除当前课程的其他课程）
      const queryBuilder = this.courseRepository.createQueryBuilder('course');
      queryBuilder.orderBy('course.sort', 'ASC');
      
      // 如果有当前课程ID，排除它
      if (courseId !== undefined && courseId !== null) {
        const numValue = typeof courseId === 'number' ? courseId : Number(courseId);
        if (Number.isFinite(numValue) && !isNaN(numValue) && numValue > 0) {
          queryBuilder.where('course.id != :courseId', { courseId: numValue });
        }
      }
      
      // 限制返回数量，避免返回过多课程
      queryBuilder.limit(10);
      
      recommendedCourses = await queryBuilder.getMany();
    }

    // 如果用户已登录，获取用户的课程权限和到期时间
    if (userId && recommendedCourses.length > 0) {
      const courseIds = recommendedCourses.map(c => c.id);
      const userAuths = await this.userCourseAuthRepository.find({
        where: {
          user_id: userId,
          course_id: In(courseIds),
        },
      });

      // 创建权限映射
      const authMap = new Map();
      userAuths.forEach(auth => {
        authMap.set(auth.course_id, auth);
      });

      // 为每个课程添加权限和到期时间信息
      return recommendedCourses.map(course => {
        const auth = authMap.get(course.id);
        return {
          ...course,
          expireTime: auth?.expire_time || null,
        };
      });
    }

    return recommendedCourses;
  }
}

