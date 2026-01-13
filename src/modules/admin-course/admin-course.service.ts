import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Question } from '../../database/entities/question.entity';
import { ExamConfig } from '../../database/entities/exam-config.entity';
import { ExamRecord } from '../../database/entities/exam-record.entity';
import { UserWrongBook } from '../../database/entities/user-wrong-book.entity';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { UserCollection } from '../../database/entities/user-collection.entity';
import { CourseRecommendation } from '../../database/entities/course-recommendation.entity';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpdateRecommendationsDto } from '../course/dto/update-recommendations.dto';

@Injectable()
export class AdminCourseService {
  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(ExamConfig)
    private examConfigRepository: Repository<ExamConfig>,
    @InjectRepository(ExamRecord)
    private examRecordRepository: Repository<ExamRecord>,
    @InjectRepository(UserWrongBook)
    private userWrongBookRepository: Repository<UserWrongBook>,
    @InjectRepository(UserAnswerLog)
    private userAnswerLogRepository: Repository<UserAnswerLog>,
    @InjectRepository(UserCollection)
    private userCollectionRepository: Repository<UserCollection>,
    @InjectRepository(CourseRecommendation)
    private courseRecommendationRepository: Repository<CourseRecommendation>,
  ) {}

  /**
   * 新增/编辑课程
   */
  async saveCourse(dto: CreateCourseDto | UpdateCourseDto, id?: number) {
    if (id) {
      const course = await this.courseRepository.findOne({ where: { id } });
      if (!course) {
        throw new NotFoundException('课程不存在');
      }
      Object.assign(course, dto);
      return await this.courseRepository.save(course);
    } else {
      const course = this.courseRepository.create(dto);
      return await this.courseRepository.save(course);
    }
  }

  /**
   * 获取课程列表
   */
  async getCourseList() {
    return await this.courseRepository.find({
      order: { sort: 'ASC' },
    });
  }

  /**
   * 获取课程详情
   */
  async getCourseDetail(id: number) {
    const course = await this.courseRepository.findOne({
      where: { id },
      relations: ['chapters'],
    });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    return course;
  }

  /**
   * 删除课程（级联删除关联数据）
   */
  async deleteCourse(id: number) {
    const course = await this.courseRepository.findOne({ where: { id } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    // 1. 查找该课程下的所有章节
    const chapters = await this.chapterRepository.find({
      where: { course_id: id },
    });
    const chapterIds = chapters.map((ch) => ch.id);

    // 2. 查找该课程下所有章节的题目
    const questions = chapterIds.length > 0
      ? await this.questionRepository.find({
          where: { chapter_id: In(chapterIds) },
        })
      : [];
    const questionIds = questions.map((q) => q.id);

    // 3. 删除用户收藏（基于题目ID）
    if (questionIds.length > 0) {
      await this.userCollectionRepository.delete({
        question_id: In(questionIds),
      });
    }

    // 4. 删除用户错题本（基于课程ID）
    await this.userWrongBookRepository.delete({
      course_id: id,
    });

    // 5. 删除用户答题记录（基于章节ID）
    if (chapterIds.length > 0) {
      await this.userAnswerLogRepository.delete({
        chapter_id: In(chapterIds),
      });
    }

    // 6. 删除题目
    if (questionIds.length > 0) {
      await this.questionRepository.delete({
        chapter_id: In(chapterIds),
      });
    }

    // 7. 删除章节
    if (chapterIds.length > 0) {
      await this.chapterRepository.delete({
        course_id: id,
      });
    }

    // 8. 删除该课程的考试记录
    const examConfigs = await this.examConfigRepository.find({
      where: { course_id: id },
    });
    const examConfigIds = examConfigs.map((config) => config.id);
    if (examConfigIds.length > 0) {
      await this.examRecordRepository.delete({
        exam_config_id: In(examConfigIds),
      });
    }

    // 9. 删除该课程的考试配置
    await this.examConfigRepository.delete({
      course_id: id,
    });

    // 10. 最后删除课程
    await this.courseRepository.remove(course);
    return { success: true };
  }

  /**
   * 获取相关推荐配置
   * @param courseId 课程ID，不传或传null表示获取公共配置
   */
  async getRecommendations(courseId?: number | null) {
    // 确保 courseId 是有效的数字或 null
    const validCourseId = courseId !== undefined && courseId !== null && !isNaN(courseId) && courseId > 0 
      ? courseId 
      : null;
    
    const recommendation = await this.courseRecommendationRepository.findOne({
      where: { course_id: validCourseId },
    });

    if (!recommendation) {
      return {
        courseId: courseId ?? null,
        recommendedCourseIds: [],
      };
    }

    return {
      courseId: recommendation.course_id,
      recommendedCourseIds: recommendation.recommended_course_ids || [],
    };
  }

  /**
   * 更新相关推荐配置
   */
  async updateRecommendations(dto: UpdateRecommendationsDto) {
    const courseId = dto.courseId ?? null;

    // 查找是否已存在配置
    let recommendation = await this.courseRecommendationRepository.findOne({
      where: { course_id: courseId },
    });

    if (recommendation) {
      // 更新现有配置
      recommendation.recommended_course_ids = dto.recommendedCourseIds;
      return await this.courseRecommendationRepository.save(recommendation);
    } else {
      // 创建新配置
      recommendation = this.courseRecommendationRepository.create({
        course_id: courseId,
        recommended_course_ids: dto.recommendedCourseIds,
      });
      return await this.courseRecommendationRepository.save(recommendation);
    }
  }
}

