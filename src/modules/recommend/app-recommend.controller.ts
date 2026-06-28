import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import axios from 'axios';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository, In } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { HomeRecommendCategory } from '../../database/entities/home-recommend-category.entity';
import { HomeRecommendItem } from '../../database/entities/home-recommend-item.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type ProfessionalScope = {
  category: string;
  subCategory: string;
};

type ProfessionalFilter = {
  scopes: ProfessionalScope[];
};

@ApiTags('小程序-首页推荐')
@Controller('app/recommend')
export class AppRecommendController {
  private columnsColumnExistsCache: boolean | null = null;

  constructor(
    @InjectRepository(HomeRecommendCategory)
    private categoryRepository: Repository<HomeRecommendCategory>,
    @InjectRepository(HomeRecommendItem)
    private itemRepository: Repository<HomeRecommendItem>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(CourseCategory)
    private courseCategoryRepository: Repository<CourseCategory>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    private dataSource: DataSource,
  ) {}

  @Get('categories')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取首页推荐版块列表（包含课程详情）' })
  async getCategories(
    @CurrentUser() user?: any,
    @Query('mode') mode?: string,
    @Query('category') categoryName?: string,
    @Query('subCategory') subCategoryName?: string,
    @Query('professionalScopes') professionalScopes?: string,
  ) {
    try {
      const professionalFilter = this.buildProfessionalFilter(mode, categoryName, subCategoryName, professionalScopes);
      // 查询所有启用的推荐版块
      const columnsExists = await this.hasColumnsColumn();
      const categories = await this.createCategoryQuery('category', columnsExists)
        .where('category.status = :status', { status: 1 })
        .orderBy('category.sort', 'ASC')
        .getMany();

      if (!categories || categories.length === 0) {
        return CommonResponseDto.success([]);
      }

      const categoryIds = categories.map((category) => category.id);
      const recommendItems = await this.itemRepository.find({
        where: { category_id: In(categoryIds) },
        order: { category_id: 'ASC', sort: 'ASC' },
      });
      const courseIds = Array.from(new Set(recommendItems.map((item) => item.course_id).filter(Boolean)));
      const courses =
        courseIds.length > 0
          ? await this.courseRepository
              .createQueryBuilder('course')
              .select([
                'course.id',
                'course.name',
                'course.subject',
                'course.category',
                'course.sub_category',
                'course.school',
                'course.major',
                'course.exam_year',
                'course.answer_year',
                'course.cover_img',
                'course.price',
                'course.agent_price',
                'course.is_free',
                'course.validity_days',
                'course.student_count',
                'course.sort',
                'course.status',
                'course.introduction',
                'course.content_type',
                'course.file_url',
                'course.file_name',
                'course.file_type',
                'course.allow_source_file',
                'course.recommended_course_ids',
                'course.create_time',
                'course.update_time',
              ])
              .where('course.id IN (:...courseIds)', { courseIds })
              .getMany()
          : [];
      const courseMap = new Map(courses.map((course) => [course.id, course]));
      const bindCategoryIds = categories
        .filter((category) => category.type === 'category' && category.bind_category_id)
        .map((category) => category.bind_category_id as number);
      const boundPrimaryCategories =
        bindCategoryIds.length > 0
          ? await this.courseCategoryRepository.find({ where: { id: In(bindCategoryIds) } })
          : [];
      const primaryCategoryMap = new Map(boundPrimaryCategories.map((category) => [category.id, category]));
      const secondaryCategories =
        bindCategoryIds.length > 0
          ? await this.courseCategoryRepository.find({
              where: { parent_id: In(bindCategoryIds), status: 1 },
              order: { sort: 'ASC', id: 'ASC' },
            })
          : [];
      const secondaryByParent = new Map<number, CourseCategory[]>();
      secondaryCategories.forEach((category) => {
        const list = secondaryByParent.get(category.parent_id || 0) || [];
        list.push(category);
        secondaryByParent.set(category.parent_id || 0, list);
      });
      const courseCountMap = await this.buildSubCategoryCourseCountMap(
        secondaryCategories,
        primaryCategoryMap,
      );

      const authMap = new Map<number, Date | null>();
      if (user?.userId && courseIds.length > 0) {
        const auths = await this.userCourseAuthRepository.find({
          where: {
            user_id: user.userId,
            course_id: In(courseIds),
          },
        });
        const now = new Date();
        auths.forEach((auth) => {
          if (!auth.expire_time || auth.expire_time > now) {
            authMap.set(auth.course_id, auth.expire_time || null);
          }
        });
      }

      const itemsByCategory = new Map<number, HomeRecommendItem[]>();
      recommendItems.forEach((item) => {
        const list = itemsByCategory.get(item.category_id) || [];
        list.push(item);
        itemsByCategory.set(item.category_id, list);
      });

      const result = categories
        .map((category) => {
        if (category.type === 'category') {
          const primaryCategory = category.bind_category_id ? primaryCategoryMap.get(category.bind_category_id) : null;
          const primaryName = primaryCategory?.name || '';
          const items = (secondaryByParent.get(category.bind_category_id || 0) || [])
            .filter((subCategory) => this.matchesProfessionalFilter(primaryName, subCategory.name, professionalFilter))
            .map((subCategory) => ({
              id: subCategory.id,
              item_type: 'sub_category',
              name: subCategory.name,
              title: subCategory.name,
              category: primaryName,
              sub_category: subCategory.name,
              parent_id: subCategory.parent_id,
              cover: subCategory.cover_img || '',
              cover_img: subCategory.cover_img || '',
              course_count: courseCountMap.get(subCategory.id) || 0,
            }));

          return {
            id: category.id,
            name: professionalFilter ? this.getProfessionalFilterLabel(professionalFilter) : category.name,
            type: 'category',
            bind_category_id: category.bind_category_id || null,
            bind_category_name: primaryName,
            columns: this.normalizeColumns(category.columns),
            items,
            display_type: 'category-grid',
          };
        }

        const items = itemsByCategory.get(category.id) || [];
        const sortedCourses = items
          .map((item) => {
            const course = courseMap.get(item.course_id);
            if (!course) return null;

            const price = Number(course.price) || 0;
            const isFree = course.is_free === 1;
            const expireTime = authMap.get(course.id) || null;
            const hasAuth = price === 0 || isFree || authMap.has(course.id);

            return {
              ...course,
              hasAuth,
              expireTime,
            };
          })
          .filter((course) =>
            course
              ? this.matchesProfessionalFilter(course.category, course.sub_category, professionalFilter)
              : false,
          );

        return {
          id: category.id,
          name: professionalFilter ? `${this.getProfessionalFilterLabel(professionalFilter)}推荐` : category.name,
          type: category.type || 'course',
          columns: this.normalizeColumns(category.columns),
          items: sortedCourses,
        };
      })
      .filter((category) => Array.isArray(category.items) && category.items.length > 0);

      return CommonResponseDto.success(result);
    } catch (error) {
      console.error('获取推荐版块失败:', error);
      throw error;
    }
  }

  @Get('image-proxy')
  @ApiOperation({ summary: '首页推荐图片代理（供小程序绕过图片域名/304缓存问题）' })
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new BadRequestException('图片地址无效');
    }

    const target = new URL(url);
    const allowedHosts = ['tcb.qcloud.la', 'qcloud.la', 'myqcloud.com', 'myqcloud.la'];
    const allowed = allowedHosts.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`));
    if (!allowed) {
      throw new BadRequestException('图片域名不允许代理');
    }

    const imageRes = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const contentType = imageRes.headers['content-type'] || 'image/png';
    if (!String(contentType).startsWith('image/')) {
      throw new BadRequestException('目标地址不是图片');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.send(Buffer.from(imageRes.data));
  }

  private normalizeColumns(columns?: number | null) {
    const value = Number(columns || 3);
    if (!Number.isFinite(value)) return 3;
    return Math.min(4, Math.max(1, Math.round(value)));
  }

  private buildProfessionalFilter(
    mode?: string,
    categoryName?: string,
    subCategoryName?: string,
    professionalScopes?: string,
  ): ProfessionalFilter | null {
    if (String(mode || '').trim() !== 'professional') {
      return null;
    }
    const scopes = this.parseProfessionalScopes(professionalScopes);
    if (scopes.length > 0) {
      return { scopes };
    }
    const category = this.normalizeCategoryText(categoryName);
    const subCategory = this.normalizeCategoryText(subCategoryName);
    if (!category || !subCategory) {
      return null;
    }
    return { scopes: [{ category, subCategory }] };
  }

  private normalizeCategoryText(value?: string | null) {
    return String(value || '').trim();
  }

  private parseProfessionalScopes(value?: string): ProfessionalScope[] {
    if (!value) {
      return [];
    }
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const uniqueMap = new Map<string, ProfessionalScope>();
      parsed.forEach((item) => {
        const category = this.normalizeCategoryText(item?.category);
        const subCategory = this.normalizeCategoryText(item?.subCategory || item?.sub_category);
        if (!category || !subCategory) return;
        uniqueMap.set(`${category}__${subCategory}`, { category, subCategory });
      });
      return Array.from(uniqueMap.values());
    } catch (error) {
      console.warn('解析专业模式筛选条件失败:', error);
      return [];
    }
  }

  private getProfessionalFilterLabel(filter: ProfessionalFilter) {
    const names = filter.scopes.map((scope) => scope.subCategory).filter(Boolean);
    if (names.length <= 1) {
      return names[0] || '专业模式';
    }
    return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')}等${names.length}个专业`;
  }

  private matchesProfessionalFilter(
    categoryName: string | null | undefined,
    subCategoryName: string | null | undefined,
    filter: ProfessionalFilter | null,
  ) {
    if (!filter) {
      return true;
    }
    const category = this.normalizeCategoryText(categoryName);
    const subCategory = this.normalizeCategoryText(subCategoryName);
    return filter.scopes.some((scope) => category === scope.category && subCategory === scope.subCategory);
  }

  private createCategoryQuery(alias: string, includeColumns: boolean) {
    const fields = [
      `${alias}.id`,
      `${alias}.name`,
      `${alias}.type`,
      `${alias}.bind_category_id`,
      `${alias}.sort`,
      `${alias}.status`,
      `${alias}.create_time`,
      `${alias}.update_time`,
    ];
    if (includeColumns) {
      fields.splice(5, 0, `${alias}.columns`);
    }
    return this.categoryRepository.createQueryBuilder(alias).select(fields);
  }

  private async buildSubCategoryCourseCountMap(
    secondaryCategories: CourseCategory[],
    primaryCategoryMap: Map<number, CourseCategory>,
  ) {
    const countMap = new Map<number, number>();
    if (secondaryCategories.length === 0) {
      return countMap;
    }

    const pairs = secondaryCategories
      .map((subCategory) => {
        const primaryCategory = primaryCategoryMap.get(Number(subCategory.parent_id) || 0);
        const category = String(primaryCategory?.name || '').trim();
        const subCategoryName = String(subCategory.name || '').trim();
        if (!category || !subCategoryName) {
          return null;
        }
        return {
          id: subCategory.id,
          category,
          subCategory: subCategoryName,
        };
      })
      .filter(Boolean) as Array<{ id: number; category: string; subCategory: string }>;

    if (pairs.length === 0) {
      return countMap;
    }

    const queryBuilder = this.courseRepository
      .createQueryBuilder('course')
      .select('course.category', 'category')
      .addSelect('course.sub_category', 'sub_category')
      .addSelect('COUNT(course.id)', 'count')
      .where('course.status = :status', { status: 1 })
      .groupBy('course.category')
      .addGroupBy('course.sub_category');

    queryBuilder.andWhere(
      new Brackets((whereBuilder) => {
        pairs.forEach((pair, index) => {
          const condition = '(course.category = :categoryName' + index + ' AND course.sub_category = :subCategoryName' + index + ')';
          const parameters = {
            ['categoryName' + index]: pair.category,
            ['subCategoryName' + index]: pair.subCategory,
          };
          if (index === 0) {
            whereBuilder.where(condition, parameters);
            return;
          }
          whereBuilder.orWhere(condition, parameters);
        });
      }),
    );

    const countRows = await queryBuilder.getRawMany();
    const countByKey = new Map<string, number>();
    countRows.forEach((row) => {
      const key = `${String(row.category || '').trim()}__${String(row.sub_category || '').trim()}`;
      countByKey.set(key, Number(row.count) || 0);
    });

    pairs.forEach((pair) => {
      countMap.set(pair.id, countByKey.get(`${pair.category}__${pair.subCategory}`) || 0);
    });

    return countMap;
  }

  private async hasColumnsColumn() {
    if (this.columnsColumnExistsCache !== null) {
      return this.columnsColumnExistsCache;
    }
    const rows = await this.dataSource.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'home_recommend_category'
         AND COLUMN_NAME = 'columns'`,
    );
    this.columnsColumnExistsCache = Number(rows?.[0]?.count || 0) > 0;
    return this.columnsColumnExistsCache;
  }

}
