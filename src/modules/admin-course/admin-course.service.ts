import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Injectable()
export class AdminCourseService {
  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
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
   * 删除课程
   */
  async deleteCourse(id: number) {
    const course = await this.courseRepository.findOne({ where: { id } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    await this.courseRepository.remove(course);
    return { success: true };
  }
}

