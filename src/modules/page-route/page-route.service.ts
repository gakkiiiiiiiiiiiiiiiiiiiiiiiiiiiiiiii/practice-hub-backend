import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PageRoute } from '../../database/entities/page-route.entity';
import { SyncPageRoutesDto } from './dto/sync-page-routes.dto';
import { GetPageRoutesDto } from './dto/get-page-routes.dto';

@Injectable()
export class PageRouteService {
	private readonly logger = new Logger(PageRouteService.name);

	constructor(
		@InjectRepository(PageRoute)
		private pageRouteRepository: Repository<PageRoute>,
	) {}

	/**
	 * 同步页面路由（批量更新）
	 */
	async syncPageRoutes(dto: SyncPageRoutesDto) {
		const { routes } = dto;
		let createdCount = 0;
		let updatedCount = 0;

		for (const route of routes) {
			const existingRoute = await this.pageRouteRepository.findOne({
				where: { path: route.path },
			});

			if (existingRoute) {
				// 更新现有路由
				existingRoute.title = route.title;
				existingRoute.type = route.type || this.detectRouteType(route.path);
				existingRoute.status = 1; // 同步时设置为启用
				await this.pageRouteRepository.save(existingRoute);
				updatedCount++;
			} else {
				// 创建新路由
				const newRoute = this.pageRouteRepository.create({
					path: route.path,
					title: route.title,
					type: route.type || this.detectRouteType(route.path),
					status: 1,
				});
				await this.pageRouteRepository.save(newRoute);
				createdCount++;
			}
		}

		// 将未在同步列表中的路由设置为禁用（可选，根据需求决定）
		// 这里暂时不自动禁用，保留手动管理的灵活性

		this.logger.log(`同步页面路由完成：创建 ${createdCount} 条，更新 ${updatedCount} 条`);

		return {
			success: true,
			created: createdCount,
			updated: updatedCount,
			total: routes.length,
		};
	}

	/**
	 * 获取页面路由列表
	 */
	async getPageRoutes(dto: GetPageRoutesDto) {
		const { type, status } = dto;

		const queryBuilder = this.pageRouteRepository.createQueryBuilder('route');

		if (type) {
			queryBuilder.where('route.type = :type', { type });
		}

		if (status !== undefined) {
			queryBuilder.andWhere('route.status = :status', { status });
		}

		const routes = await queryBuilder
			.orderBy('route.type', 'ASC')
			.addOrderBy('route.path', 'ASC')
			.getMany();

		return routes.map((route) => ({
			id: route.id,
			path: route.path,
			title: route.title,
			type: route.type,
			status: route.status,
			createdAt: route.create_time,
			updatedAt: route.update_time,
		}));
	}

	/**
	 * 检测路由类型
	 */
	private detectRouteType(path: string): string {
		if (path.startsWith('/pages/sub-pages')) {
			return 'sub';
		}
		// TabBar 页面
		const tabBarPages = ['/pages/index/index', '/pages/bank/index', '/pages/user/index'];
		if (tabBarPages.includes(path)) {
			return 'tabBar';
		}
		return 'main';
	}
}
