import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Chapter } from './chapter.entity';

@Entity('course')
export class Course {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 100 })
	name: string; // 课程名称

	@Column({ length: 100, nullable: true })
	subject: string; // 科目（如：数学、英语、政治等）

	@Column({ length: 100, nullable: true })
	category: string; // 一级分类（如：考研政治、考研英语等）

	@Column({ length: 100, nullable: true })
	sub_category: string; // 二级分类（如：真题、模拟题等）

	@Column({ length: 100, nullable: true })
	school: string; // 学校（如：北京大学、清华大学等）

	@Column({ length: 100, nullable: true })
	major: string; // 专业（如：计算机科学与技术、软件工程等）

	@Column({ length: 20, nullable: true })
	exam_year: string; // 真题年份（如：2024、2023等）

	@Column({ length: 20, nullable: true })
	answer_year: string; // 答案年份（如：2024、2023等）

	@Column({ length: 500, nullable: true })
	cover_img: string; // 封面图片

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	price: number; // 价格（整数元）

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	agent_price: number; // 代理商售价（整数元）

	@Column({ type: 'tinyint', default: 0 })
	is_free: number; // 0-付费, 1-免费

	@Column({ type: 'int', nullable: true, comment: '有效期天数，null表示永久有效' })
	validity_days: number | null; // 付费课程的有效期天数，null表示永久有效

	@Column({ type: 'int', default: 0 })
	student_count: number; // 学习人数

	@Column({ type: 'int', default: 0 })
	sort: number; // 排序

	@Column({ type: 'tinyint', default: 1, comment: '状态：0-禁用，1-启用' })
	status: number; // 状态：0-禁用，1-启用

	@Column({ type: 'text', nullable: true })
	introduction: string; // 课程介绍（富文本）

	/** 课程内容类型：normal=普通题库课程，file=文件课程（PDF/Word），paper_exam=纸质专业真题 */
	@Column({ type: 'varchar', length: 20, default: 'normal' })
	content_type: string;

	/** 文件课程：文件 URL（后台上传后保存） */
	@Column({ type: 'varchar', length: 500, nullable: true })
	file_url: string | null;

	/** 文件课程：文件原始名称（用于展示与下载） */
	@Column({ type: 'varchar', length: 255, nullable: true })
	file_name: string | null;

	/** 文件课程：文件类型 pdf | doc | docx */
	@Column({ type: 'varchar', length: 20, nullable: true })
	file_type: string | null;

	/** 文件课程：文件大小（字节） */
	@Column({ type: 'bigint', default: 0 })
	file_size: number;

	/** 文件课程：PDF 总页数（生成预览缓存或首次解析后写入） */
	@Column({ type: 'int', nullable: true })
	file_page_count: number | null;

	/** 文件课程：页数缓存对应的文件版本（file_url 变更后失效） */
	@Column({ type: 'varchar', length: 32, nullable: true })
	file_page_count_key: string | null;

	/** 文件课程：是否允许用户查看源文件 */
	@Column({ type: 'tinyint', default: 0, comment: '是否允许查看源文件：0-否，1-是' })
	allow_source_file: number;

	@Column({ type: 'json', nullable: true, comment: '推荐课程ID列表（JSON数组）' })
	recommended_course_ids: number[] | null; // 课程推荐列表

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	@OneToMany(() => Chapter, (chapter) => chapter.course)
	chapters: Chapter[];
}
