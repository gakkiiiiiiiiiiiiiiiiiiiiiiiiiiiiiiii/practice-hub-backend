import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CourseType } from '../../database/entities/course-type.entity';

@Injectable()
export class CourseTypeService {
	private readonly logger = new Logger(CourseTypeService.name);

	constructor(
		@InjectRepository(CourseType)
		private courseTypeRepository: Repository<CourseType>,
	) {}

	private isMissingCourseTypeTableError(error: unknown) {
		const dbError = error as QueryFailedError & {
			code?: string;
			errno?: number;
			sqlMessage?: string;
			query?: string;
		};
		const errorText = `${dbError.message || ''} ${dbError.sqlMessage || ''} ${dbError.query || ''}`;
		return (
			error instanceof QueryFailedError &&
			(dbError.code === 'ER_NO_SUCH_TABLE' || dbError.errno === 1146) &&
			errorText.includes('course_type')
		);
	}

	private handleMissingTable(error: unknown) {
		if (this.isMissingCourseTypeTableError(error)) {
			throw new BadRequestException('课程类型表不存在，请先执行数据库迁移');
		}
		throw error;
	}

	async list(options: { onlyEnabled?: boolean } = {}) {
		const where = options.onlyEnabled ? { status: 1 } : {};
		try {
			return await this.courseTypeRepository.find({
				where,
				order: { sort: 'ASC', id: 'ASC' },
			});
		} catch (error) {
			if (this.isMissingCourseTypeTableError(error)) {
				this.logger.warn('course_type 表不存在，课程类型列表返回空数组，请执行数据库迁移');
				return [];
			}
			throw error;
		}
	}

	async create(input: Partial<CourseType>) {
		const name = String(input.name || '').trim();
		const matchKeyword = String(input.match_keyword || '').trim();
		if (!name) throw new BadRequestException('课程类型名称不能为空');
		if (!matchKeyword) throw new BadRequestException('归类关键字不能为空');
		try {
			return await this.courseTypeRepository.save(
				this.courseTypeRepository.create({
					name,
					match_keyword: matchKeyword,
					status: input.status ?? 1,
					sort: Number(input.sort) || 0,
				}),
			);
		} catch (error) {
			this.handleMissingTable(error);
		}
	}

	async update(id: number, input: Partial<CourseType>) {
		let item: CourseType | null = null;
		try {
			item = await this.courseTypeRepository.findOne({ where: { id } });
		} catch (error) {
			this.handleMissingTable(error);
		}
		if (!item) throw new NotFoundException('课程类型不存在');
		if (input.name !== undefined) item.name = String(input.name || '').trim();
		if (input.match_keyword !== undefined) item.match_keyword = String(input.match_keyword || '').trim();
		if (!item.name) throw new BadRequestException('课程类型名称不能为空');
		if (!item.match_keyword) throw new BadRequestException('归类关键字不能为空');
		if (input.status !== undefined) item.status = Number(input.status) === 0 ? 0 : 1;
		if (input.sort !== undefined) item.sort = Number(input.sort) || 0;
		try {
			return await this.courseTypeRepository.save(item);
		} catch (error) {
			this.handleMissingTable(error);
		}
	}

	async delete(id: number) {
		try {
			await this.courseTypeRepository.delete(id);
		} catch (error) {
			this.handleMissingTable(error);
		}
		return { success: true };
	}

	matchCourseType(courseName: string, types: CourseType[]) {
		const normalizedName = String(courseName || '').trim();
		return types.find((type) => type.status === 1 && normalizedName.includes(type.match_keyword));
	}
}
