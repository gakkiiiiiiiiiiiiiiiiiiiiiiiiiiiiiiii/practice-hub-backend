import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
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
    private configService: ConfigService,
    private jwtService: JwtService,
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

    const fileType = (course.file_type || '').toLowerCase();
    const isFileCourse = course.content_type === 'file' && course.file_url;
    const needPreviewUrl =
      isFileCourse && !hasAuth && price > 0 && (fileType === 'pdf' || fileType === 'doc' || fileType === 'docx');

    return {
      ...course,
      chapters,
      hasAuth,
      expireTime,
      /** 付费未购买时，试读用：PDF 为前 3 页地址，Word 暂不提供试读 */
      file_preview_url: needPreviewUrl && fileType === 'pdf' ? `/api/app/courses/${courseId}/file-preview` : undefined,
    };
  }

  /**
   * 获取课程文件预览 PDF（前 maxPages 页），仅支持 PDF 类型
   */
  async getCourseFilePreviewPdf(courseId: number, maxPages: number = 3): Promise<Buffer> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      select: ['id', 'content_type', 'file_url', 'file_type'],
    });
    if (!course || course.content_type !== 'file' || !course.file_url) {
      throw new NotFoundException('课程无文件或非文件课程');
    }
    const fileType = (course.file_type || '').toLowerCase();
    if (fileType !== 'pdf') {
      throw new NotFoundException('仅支持 PDF 试读');
    }
    const res = await axios.get(course.file_url, { responseType: 'arraybuffer', timeout: 30000 });
    const bytes = res.data as ArrayBuffer;
    const donorDoc = await PDFDocument.load(bytes);
    const pageCount = donorDoc.getPageCount();
    const pagesToCopy = Math.min(maxPages, Math.max(1, pageCount));
    if (pagesToCopy < 1) {
      throw new NotFoundException('PDF 无有效页');
    }
    const indices = Array.from({ length: pagesToCopy }, (_, i) => i);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(donorDoc, indices);
    copied.forEach((p) => newDoc.addPage(p));
    const pdfBytes = await newDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * 获取课程文件预览页数（用于图片预览：已购/免费为全部，未购付费为 3）
   */
  async getCourseFilePreviewPageInfo(courseId: number, userId?: number): Promise<{ totalPages: number }> {
    const detail = await this.getCourseDetail(courseId, userId);
    const course = detail as any;
    if (course.content_type !== 'file' || !course.file_url || (course.file_type || '').toLowerCase() !== 'pdf') {
      throw new NotFoundException('课程无 PDF 文件');
    }
    const res = await axios.get(course.file_url, { responseType: 'arraybuffer', timeout: 30000 });
    const bytes = res.data as ArrayBuffer;
    const doc = await PDFDocument.load(bytes);
    const fullCount = doc.getPageCount();
    const totalPages =
      course.hasAuth || Number(course.price) === 0 || course.is_free === 1 ? fullCount : Math.min(3, fullCount);
    return { totalPages: Math.max(1, totalPages) };
  }

  /**
   * 将课程 PDF 指定页转为预览图（用于小程序内图片预览）
   * 使用 JPEG 以在尽量保持清晰度的前提下降低传输体积。
   * 依赖 pdf2pic（需系统安装 GraphicsMagick + Ghostscript），失败时抛出
   */
  async getCourseFilePreviewPageImage(
    courseId: number,
    pageNum: number,
    userId?: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const detail = await this.getCourseDetail(courseId, userId);
    const course = detail as any;
    if (course.content_type !== 'file' || !course.file_url || (course.file_type || '').toLowerCase() !== 'pdf') {
      throw new NotFoundException('课程无 PDF 文件');
    }
    const maxPages =
      course.hasAuth || Number(course.price) === 0 || course.is_free === 1
        ? 999
        : 3;
    if (pageNum < 1 || pageNum > maxPages) {
      throw new NotFoundException('页码超出范围');
    }
    const previewScope =
      course.hasAuth || Number(course.price) === 0 || course.is_free === 1 ? 'full' : 'trial';
    const cachePath = this.getPreviewImageCachePath(courseId, pageNum, course.file_url, previewScope);
    if (fs.existsSync(cachePath)) {
      return { buffer: fs.readFileSync(cachePath), contentType: 'image/jpeg' };
    }

    let pdfBuffer: Buffer;
    if (course.hasAuth || Number(course.price) === 0 || course.is_free === 1) {
      const res = await axios.get(course.file_url, { responseType: 'arraybuffer', timeout: 30000 });
      pdfBuffer = Buffer.from(res.data as ArrayBuffer);
    } else {
      pdfBuffer = await this.getCourseFilePreviewPdf(courseId, 3);
    }
    const tmpDir = path.join(os.tmpdir(), `course-preview-${courseId}-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, 'doc.pdf');
    try {
      fs.writeFileSync(pdfPath, pdfBuffer);
      const { fromPath } = await import('pdf2pic');
      const convert = fromPath(pdfPath, {
        format: 'jpeg',
        quality: 82,
        width: 1000,
        preserveAspectRatio: true,
        density: 120,
      });
      const result = await convert(pageNum, { responseType: 'buffer' }) as { buffer?: Buffer; data?: Buffer };
      const buffer = result?.buffer ?? result?.data;
      if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('pdf2pic 未返回图片 buffer，请确认容器已安装 GraphicsMagick 和 Ghostscript');
      }
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, buffer);
      return { buffer, contentType: 'image/jpeg' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`课程预览页转图失败: ${message}`);
    } finally {
      try {
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
      } catch (_) {}
    }
  }

  private getPreviewImageCachePath(
    courseId: number,
    pageNum: number,
    fileUrl: string,
    scope: 'full' | 'trial',
  ): string {
    const version = createHash('md5').update(`${fileUrl}|${scope}|jpeg|1000|120|82`).digest('hex').slice(0, 12);
    return path.join(os.tmpdir(), 'course-preview-cache', String(courseId), version, `${pageNum}.jpg`);
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

  /**
   * 生成小程序内嵌 PDF 预览用短期凭证（5 分钟有效）
   */
  async createPreviewTicket(courseId: number, userId?: number): Promise<{ ticket: string; viewerUrl: string }> {
    const course = await this.courseRepository.findOne({ where: { id: courseId }, select: ['id', 'content_type', 'file_type'] });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const payload = { courseId, userId: userId ?? null, purpose: 'pdf-viewer' };
    const ticket = this.jwtService.sign(payload, { expiresIn: '5m' });
    const baseUrl = (this.configService.get('BASE_URL') || '').replace(/\/$/, '');
    const apiPrefix = baseUrl ? `${baseUrl}/api` : '/api';
    const viewerUrl = `${apiPrefix}/app/pdf-viewer?courseId=${courseId}&ticket=${encodeURIComponent(ticket)}`;
    return { ticket, viewerUrl };
  }

  /**
   * 校验预览凭证并返回 userId（用于 file-preview 接口）
   */
  verifyPreviewTicket(ticket: string): { courseId: number; userId: number | null } | null {
    try {
      const payload = this.jwtService.verify(ticket) as { courseId?: number; userId?: number; purpose?: string };
      if (payload.purpose !== 'pdf-viewer' || payload.courseId == null) return null;
      return { courseId: payload.courseId, userId: payload.userId ?? null };
    } catch {
      return null;
    }
  }
}
