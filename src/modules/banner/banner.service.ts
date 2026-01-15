import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Banner } from '../../database/entities/banner.entity';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { GetBannerListDto } from './dto/get-banner-list.dto';

@Injectable()
export class BannerService {
	constructor(
		@InjectRepository(Banner)
		private bannerRepository: Repository<Banner>,
	) {}

	/**
	 * 获取轮播图列表（管理端）
	 */
	async getBannerList(dto: GetBannerListDto) {
		const { page = 1, pageSize = 10, status } = dto;
		const skip = (page - 1) * pageSize;

		const queryBuilder = this.bannerRepository.createQueryBuilder('banner');

		if (status !== undefined) {
			queryBuilder.where('banner.status = :status', { status });
		}

		const [list, total] = await queryBuilder
			.orderBy('banner.sort_order', 'ASC')
			.addOrderBy('banner.create_time', 'DESC')
			.skip(skip)
			.take(pageSize)
			.getManyAndCount();

		return {
			list: list.map((banner) => ({
				id: banner.id,
				image: banner.image,
				link: banner.link,
				title: banner.title,
				sortOrder: banner.sort_order,
				status: banner.status,
				createdAt: banner.create_time,
				updatedAt: banner.update_time,
			})),
			total,
			page,
			pageSize,
		};
	}

	/**
	 * 获取启用的轮播图列表（小程序端）
	 */
	async getActiveBanners() {
		const banners = await this.bannerRepository.find({
			where: { status: 1 },
			order: {
				sort_order: 'ASC',
				create_time: 'DESC',
			},
		});

		return banners.map((banner) => ({
			id: banner.id,
			image: banner.image,
			link: banner.link,
			title: banner.title,
		}));
	}

	/**
	 * 获取轮播图详情
	 */
	async getBannerDetail(id: number) {
		const banner = await this.bannerRepository.findOne({ where: { id } });

		if (!banner) {
			throw new NotFoundException('轮播图不存在');
		}

		return {
			id: banner.id,
			image: banner.image,
			link: banner.link,
			title: banner.title,
			sortOrder: banner.sort_order,
			status: banner.status,
			createdAt: banner.create_time,
			updatedAt: banner.update_time,
		};
	}

	/**
	 * 创建轮播图
	 */
	async createBanner(dto: CreateBannerDto) {
		const banner = this.bannerRepository.create({
			image: dto.image,
			link: dto.link || '',
			title: dto.title || '',
			sort_order: dto.sort_order !== undefined ? dto.sort_order : 0,
			status: dto.status !== undefined ? dto.status : 1,
		});

		const savedBanner = await this.bannerRepository.save(banner);

		return {
			id: savedBanner.id,
			image: savedBanner.image,
			link: savedBanner.link,
			title: savedBanner.title,
			sortOrder: savedBanner.sort_order,
			status: savedBanner.status,
			createdAt: savedBanner.create_time,
		};
	}

	/**
	 * 更新轮播图
	 */
	async updateBanner(id: number, dto: UpdateBannerDto) {
		const banner = await this.bannerRepository.findOne({ where: { id } });

		if (!banner) {
			throw new NotFoundException('轮播图不存在');
		}

		if (dto.image !== undefined) {
			banner.image = dto.image;
		}
		if (dto.link !== undefined) {
			banner.link = dto.link;
		}
		if (dto.title !== undefined) {
			banner.title = dto.title;
		}
		if (dto.sort_order !== undefined) {
			banner.sort_order = dto.sort_order;
		}
		if (dto.status !== undefined) {
			banner.status = dto.status;
		}

		const updatedBanner = await this.bannerRepository.save(banner);

		return {
			id: updatedBanner.id,
			image: updatedBanner.image,
			link: updatedBanner.link,
			title: updatedBanner.title,
			sortOrder: updatedBanner.sort_order,
			status: updatedBanner.status,
			updatedAt: updatedBanner.update_time,
		};
	}

	/**
	 * 删除轮播图
	 */
	async deleteBanner(id: number) {
		const result = await this.bannerRepository.delete(id);

		if (result.affected === 0) {
			throw new NotFoundException('轮播图不存在');
		}

		return { success: true };
	}

	/**
	 * 批量更新排序
	 */
	async updateSortOrder(ids: number[]) {
		if (!Array.isArray(ids) || ids.length === 0) {
			throw new BadRequestException('ID列表不能为空');
		}

		const banners = await this.bannerRepository.find({ where: { id: In(ids) } });

		if (banners.length !== ids.length) {
			throw new BadRequestException('部分轮播图不存在');
		}

		// 更新排序号
		for (let i = 0; i < ids.length; i++) {
			await this.bannerRepository.update(ids[i], { sort_order: i });
		}

		return { success: true };
	}
}
