import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseType } from '../../database/entities/course-type.entity';

@Injectable()
export class CourseTypeService {
	constructor(
		@InjectRepository(CourseType)
		private courseTypeRepository: Repository<CourseType>,
	) {}

	async list(options: { onlyEnabled?: boolean } = {}) {
		const where = options.onlyEnabled ? { status: 1 } : {};
		return this.courseTypeRepository.find({
			where,
			order: { sort: 'ASC', id: 'ASC' },
		});
	}

	async create(input: Partial<CourseType>) {
		const name = String(input.name || '').trim();
		const matchKeyword = String(input.match_keyword || '').trim();
		if (!name) throw new BadRequestException('课程类型名称不能为空');
		if (!matchKeyword) throw new BadRequestException('归类关键字不能为空');
		return this.courseTypeRepository.save(
			this.courseTypeRepository.create({
				name,
				match_keyword: matchKeyword,
				status: input.status ?? 1,
				sort: Number(input.sort) || 0,
			}),
		);
	}

	async update(id: number, input: Partial<CourseType>) {
		const item = await this.courseTypeRepository.findOne({ where: { id } });
		if (!item) throw new NotFoundException('课程类型不存在');
		if (input.name !== undefined) item.name = String(input.name || '').trim();
		if (input.match_keyword !== undefined) item.match_keyword = String(input.match_keyword || '').trim();
		if (!item.name) throw new BadRequestException('课程类型名称不能为空');
		if (!item.match_keyword) throw new BadRequestException('归类关键字不能为空');
		if (input.status !== undefined) item.status = Number(input.status) === 0 ? 0 : 1;
		if (input.sort !== undefined) item.sort = Number(input.sort) || 0;
		return this.courseTypeRepository.save(item);
	}

	async delete(id: number) {
		await this.courseTypeRepository.delete(id);
		return { success: true };
	}

	matchCourseType(courseName: string, types: CourseType[]) {
		const normalizedName = String(courseName || '').trim();
		return types.find((type) => type.status === 1 && normalizedName.includes(type.match_keyword));
	}
}
