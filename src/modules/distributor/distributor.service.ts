import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as https from 'https';
import { Distributor } from '../../database/entities/distributor.entity';
import { DistributionRelation } from '../../database/entities/distribution-relation.entity';
import { DistributionOrder } from '../../database/entities/distribution-order.entity';
import { DistributionConfig } from '../../database/entities/distribution-config.entity';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import {
	ActivationCode,
	ActivationCodeSourceType,
	ActivationCodeStatus,
	ActivationCodeTargetType,
} from '../../database/entities/activation-code.entity';
import { Course } from '../../database/entities/course.entity';
import { PackagePlan } from '../../database/entities/package-plan.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { UpdateDistributorStatusDto } from './dto/update-distributor-status.dto';
import { UpdateDistributionConfigDto } from './dto/update-distribution-config.dto';
import { OrderService } from '../order/order.service';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class DistributorService {
	private readonly logger = new Logger(DistributorService.name);

	constructor(
		@InjectRepository(Distributor)
		private distributorRepository: Repository<Distributor>,
		@InjectRepository(DistributionRelation)
		private distributionRelationRepository: Repository<DistributionRelation>,
		@InjectRepository(DistributionOrder)
		private distributionOrderRepository: Repository<DistributionOrder>,
		@InjectRepository(DistributionConfig)
		private distributionConfigRepository: Repository<DistributionConfig>,
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
		@InjectRepository(Order)
		private orderRepository: Repository<Order>,
		@InjectRepository(ActivationCode)
		private activationCodeRepository: Repository<ActivationCode>,
		@InjectRepository(Course)
		private courseRepository: Repository<Course>,
		@InjectRepository(PackagePlan)
		private packagePlanRepository: Repository<PackagePlan>,
		private configService: ConfigService,
		@Inject(forwardRef(() => OrderService))
		private orderService: OrderService,
			@Inject(forwardRef(() => UploadService))
			private uploadService: UploadService,
			private dataSource: DataSource,
		) {}

	/**
	 * 申请成为分销用户
	 */
	async applyDistributor(userId: number) {
		// 检查是否已经是分销用户
		const existing = await this.distributorRepository.findOne({
			where: { user_id: userId },
		});

		if (existing) {
			if (existing.status === 1) {
				throw new BadRequestException('您已经是分销用户');
			}
			if (existing.status === 0) {
				throw new BadRequestException('您的申请正在审核中，请耐心等待');
			}
			if (existing.status === 2) {
				// 重新申请
				existing.status = 0;
				existing.reject_reason = null;
				await this.distributorRepository.save(existing);
				return { message: '申请已提交，等待审核' };
			}
		}

		// 生成分销商编号
		const distributorCode = this.generateDistributorCode(userId);

		// 创建分销用户
		const distributor = this.distributorRepository.create({
			user_id: userId,
			distributor_code: distributorCode,
			status: 0, // 待审核
		});

		await this.distributorRepository.save(distributor);

		return {
			message: '申请已提交，等待审核',
			distributor_code: distributorCode,
		};
	}

	/**
	 * 生成专属小程序二维码
	 */
	async generateQRCode(userId: number, refresh = false) {
		let distributor = await this.distributorRepository.findOne({
			where: { user_id: userId },
		});

		if (!distributor) {
			const appUser = await this.appUserRepository.findOne({ where: { id: userId } });
			if (appUser?.role === AppUserRole.ADMIN) {
				distributor = await this.createApprovedDistributorForUser(userId);
			} else {
				throw new NotFoundException('您还不是分销用户');
			}
		}

		if (distributor.status !== 1) {
			throw new BadRequestException('您的分销资格尚未通过审核');
		}

		// 如果已有二维码，直接返回
		if (distributor.qr_code_url && !refresh) {
			return {
				qr_code_url: distributor.qr_code_url,
				distributor_code: distributor.distributor_code,
			};
		}

		// 调用微信小程序生成二维码接口
		const appid = this.configService.get('WECHAT_APPID') || this.configService.get('AppID');
		const secret =
			this.configService.get('WECHAT_SECRET') || this.configService.get('WECHAT_APPSECRET') || this.configService.get('AppSecret');

		if (!appid || !secret) {
			throw new BadRequestException('微信配置缺失，无法生成二维码');
		}

		try {
			// 获取 access_token
			const accessToken = await this.getWeChatAccessToken(appid, secret);

			// 生成小程序码（永久有效，数量有限制）
			// 使用 scene 参数传递分销商编号
			const qrCodeUrl = await this.generateWeChatQRCode(accessToken, distributor.distributor_code);

			// 保存二维码URL
			distributor.qr_code_url = qrCodeUrl;
			await this.distributorRepository.save(distributor);

			return {
				qr_code_url: qrCodeUrl,
				distributor_code: distributor.distributor_code,
			};
		} catch (error) {
			this.logger.error('生成二维码失败:', error.message);
			throw new BadRequestException('生成二维码失败，请稍后重试');
		}
	}

	/**
	 * 通过分销商编号注册，绑定上下级关系
	 */
	async bindDistributionRelation(userId: number, distributorCode: string) {
		// 检查用户是否已经有上级
		const existingRelation = await this.distributionRelationRepository.findOne({
			where: { user_id: userId },
		});

		if (existingRelation) {
			throw new BadRequestException('您已经绑定过上级分销商');
		}

		// 查找分销商
		const distributor = await this.distributorRepository.findOne({
			where: { distributor_code: distributorCode },
		});

		if (!distributor) {
			throw new NotFoundException('分销商编号不存在');
		}

		if (distributor.status !== 1) {
			throw new BadRequestException('该分销商状态异常');
		}

		// 不能绑定自己
		if (distributor.user_id === userId) {
			throw new BadRequestException('不能绑定自己为上级');
		}

		// 检查是否形成循环（不能绑定自己的下级）
		const isSubordinate = await this.checkIsSubordinate(distributor.user_id, userId);
		if (isSubordinate) {
			throw new BadRequestException('不能绑定自己的下级为上级');
		}

		// 获取配置，确定最大层级
		const config = await this.getDistributionConfig();
		const maxLevel = config.max_level || 3;

		// 查找分销商的层级
		const distributorRelation = await this.distributionRelationRepository.findOne({
			where: { user_id: distributor.user_id },
		});

		const level = distributorRelation ? distributorRelation.level + 1 : 1;

		// 检查是否超过最大层级
		if (level > maxLevel) {
			throw new BadRequestException(`最多支持 ${maxLevel} 级分销，无法继续绑定`);
		}

		// 创建分销关系
		const relation = this.distributionRelationRepository.create({
			user_id: userId,
			distributor_id: distributor.id,
			level,
			source_code: distributorCode,
		});

		await this.distributionRelationRepository.save(relation);

		// 更新分销商的下级数量
		distributor.subordinate_count += 1;
		await this.distributorRepository.save(distributor);

		return {
			message: '绑定成功',
			distributor_id: distributor.id,
			level,
		};
	}

	/**
	 * 处理订单分成（在订单支付成功后调用）
	 */
	async processOrderCommission(orderId: number) {
		const order = await this.orderRepository.findOne({
			where: { id: orderId },
		});

		if (!order) {
			this.logger.warn(`订单不存在: ${orderId}`);
			return;
		}

		// 只处理已支付的订单
		if (order.status !== OrderStatus.PAID) {
			this.logger.warn(`订单状态不是已支付: ${orderId}, status: ${order.status}`);
			return;
		}

		// 查找购买用户的上级分销关系链
		const relations = await this.getDistributionChain(order.user_id);

		if (relations.length === 0) {
			this.logger.log(`订单 ${orderId} 没有分销关系，无需分成`);
			return;
		}

		// 获取配置
		const config = await this.getDistributionConfig();
		const commissionRates = config.commission_rates || [10, 5, 2]; // 默认分成比例

		// 计算并记录每级分成
		for (const relation of relations) {
			const level = relation.level;
			const rate = commissionRates[level - 1] || 0; // 数组索引从0开始，层级从1开始

			if (rate <= 0) {
				continue; // 该层级没有分成
			}

			const commissionAmount = (Number(order.amount) * rate) / 100;

			// 检查是否已记录过（防止重复计算）
			const existing = await this.distributionOrderRepository.findOne({
				where: {
					order_id: orderId,
					distributor_id: relation.distributor_id,
				},
			});

			if (existing) {
				continue; // 已记录过，跳过
			}

			// 创建分成记录
			const distributionOrder = this.distributionOrderRepository.create({
				order_id: orderId,
				distributor_id: relation.distributor_id,
				buyer_id: order.user_id,
				level,
				order_amount: Number(order.amount),
				commission_rate: rate,
				commission_amount: commissionAmount,
				status: 0, // 待结算
			});

			await this.distributionOrderRepository.save(distributionOrder);

			// 更新分销商的收益统计
			await this.updateDistributorEarnings(relation.distributor_id, commissionAmount);
		}

		this.logger.log(`订单 ${orderId} 分成处理完成，共 ${relations.length} 级分成`);
	}

	/**
	 * 获取分销关系链（从用户到所有上级）
	 */
	private async getDistributionChain(userId: number): Promise<DistributionRelation[]> {
		const relations: DistributionRelation[] = [];
		let currentUserId = userId;

		// 最多查询 max_level 层
		const config = await this.getDistributionConfig();
		const maxLevel = config.max_level || 3;

		for (let i = 0; i < maxLevel; i++) {
			const relation = await this.distributionRelationRepository.findOne({
				where: { user_id: currentUserId },
				relations: ['distributor'],
			});

			if (!relation) {
				break; // 没有上级了
			}

			// 检查分销商状态
			const distributor = await this.distributorRepository.findOne({
				where: { id: relation.distributor_id },
			});

			if (!distributor || distributor.status !== 1) {
				break; // 分销商状态异常，停止向上查找
			}

			relations.push(relation);
			currentUserId = distributor.user_id;
		}

		return relations;
	}

	/**
	 * 检查是否是下级
	 */
	private async checkIsSubordinate(distributorUserId: number, checkUserId: number): Promise<boolean> {
		let currentUserId = distributorUserId;

		for (let i = 0; i < 10; i++) {
			// 最多检查10层，防止无限循环
			const relation = await this.distributionRelationRepository.findOne({
				where: { user_id: currentUserId },
			});

			if (!relation) {
				return false; // 没有上级了，不是下级
			}

			if (relation.distributor_id === checkUserId) {
				return true; // 找到了，是下级
			}

			const distributor = await this.distributorRepository.findOne({
				where: { id: relation.distributor_id },
			});

			if (!distributor) {
				return false;
			}

			currentUserId = distributor.user_id;
		}

		return false;
	}

	/**
	 * 更新分销商收益统计
	 */
	private async updateDistributorEarnings(distributorId: number, amount: number) {
		const distributor = await this.distributorRepository.findOne({
			where: { id: distributorId },
		});

		if (distributor) {
			distributor.total_earnings = Number(distributor.total_earnings) + amount;
			distributor.withdrawable_amount = Number(distributor.withdrawable_amount) + amount;
			distributor.total_orders += 1;
			await this.distributorRepository.save(distributor);
		}
	}

	/**
	 * 获取微信 access_token
	 */
	private async getWeChatAccessToken(appid: string, secret: string): Promise<string> {
		const httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		});

		const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
			params: {
				grant_type: 'client_credential',
				appid,
				secret,
			},
			httpsAgent,
		});

		if (response.data.errcode) {
			throw new Error(`获取 access_token 失败: ${response.data.errmsg}`);
		}

		return response.data.access_token;
	}

	/**
	 * 生成微信小程序码
	 */
	private async generateWeChatQRCode(accessToken: string, distributorCode: string): Promise<string> {
		const httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		});
		const page = this.configService.get<string>('DISTRIBUTOR_QR_PAGE') || 'pages/index/index';
		const envVersion = this.configService.get<string>('DISTRIBUTOR_QR_ENV_VERSION') || 'release';
		const scene = `inviterid=${distributorCode}`;

		// 使用 getUnlimited 接口生成小程序码（数量无限制）
		const response = await axios.post(
			`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`,
			{
				scene, // 场景值，传递分销商编号
				page, // 扫码后跳转的页面
				check_path: false, // 页面未发布或体验版路径校验不通过时仍可生成
				env_version: envVersion,
				width: 280, // 二维码宽度
				auto_color: false,
				line_color: { r: 0, g: 0, b: 0 },
			},
			{
				httpsAgent,
				responseType: 'arraybuffer', // 返回二进制数据
			},
		);

		// 检查响应是否是错误信息（微信 API 错误时返回 JSON）
		const contentType = response.headers['content-type'] || '';
		const fileBuffer = Buffer.from(response.data);
		const responseText = fileBuffer.toString('utf-8').trim();
		if (contentType.includes('application/json') || contentType.includes('text/') || responseText.startsWith('{')) {
			const errorData = JSON.parse(responseText);
			if (errorData.errcode) {
				this.logger.error('微信生成二维码失败:', errorData);
				throw new BadRequestException(
					`生成二维码失败: ${errorData.errmsg || '未知错误'} (错误码: ${errorData.errcode})`,
				);
			}
		}
		if (!fileBuffer.length || !contentType.startsWith('image/')) {
			throw new BadRequestException('微信生成二维码失败：未返回有效图片数据');
		}

		// 将二维码图片上传到 COS 或保存到本地
		try {
			// 创建一个模拟的 Multer File 对象用于上传
			const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
			const mockFile: Express.Multer.File = {
				fieldname: 'qrcode',
				originalname: `qrcode_${distributorCode}_${Date.now()}.${ext}`,
				encoding: '7bit',
				mimetype: contentType,
				size: fileBuffer.length,
				buffer: fileBuffer,
				destination: '',
				filename: '',
				path: '',
				stream: null as any,
			};

			// 使用 UploadService 上传图片（管理端上传，openid 为空）
			const imageUrl = await this.uploadService.uploadImage(mockFile, 'qrcodes', '');
			this.logger.log(`二维码上传成功: ${imageUrl}`);
			return imageUrl;
		} catch (uploadError: any) {
			this.logger.warn('二维码上传失败，使用 base64 方案:', uploadError?.message || uploadError);
			// 临时方案：将图片转为 base64（如果上传失败）
			const base64 = Buffer.from(response.data).toString('base64');
			return `data:image/png;base64,${base64}`;
		}
	}

	/**
	 * 生成分销商编号
	 */
	private generateDistributorCode(userId: number): string {
		const timestamp = Date.now().toString().slice(-8); // 取后8位
		const random = Math.floor(Math.random() * 1000)
			.toString()
			.padStart(3, '0');
		return `D${userId}${timestamp}${random}`;
	}

	private async createApprovedDistributorForUser(userId: number): Promise<Distributor> {
		const distributor = this.distributorRepository.create({
			user_id: userId,
			distributor_code: this.generateDistributorCode(userId),
			status: 1,
		});
		return this.distributorRepository.save(distributor);
	}

	/**
	 * 获取分销配置（如果不存在则创建默认配置）
	 */
	async getDistributionConfig(): Promise<DistributionConfig> {
		let config = await this.distributionConfigRepository.findOne({
			where: { id: 1 },
		});

		if (!config) {
			config = this.distributionConfigRepository.create({
				id: 1,
				max_level: 3,
				commission_rates: [10, 5, 2], // 1级10%，2级5%，3级2%
				min_withdraw_amount: 10,
				is_enabled: 1,
			});
			await this.distributionConfigRepository.save(config);
		}

		return config;
	}

	/**
	 * 获取分销用户信息
	 */
	async getDistributorInfo(userId: number) {
		const [foundDistributor, appUser] = await Promise.all([
			this.distributorRepository.findOne({
				where: { user_id: userId },
				relations: ['user'],
			}),
			this.appUserRepository.findOne({ where: { id: userId } }),
		]);
		let distributor = foundDistributor;
		const isAppAdmin = appUser?.role === AppUserRole.ADMIN;

		if (!distributor) {
			if (isAppAdmin) {
				distributor = await this.createApprovedDistributorForUser(userId);
			} else {
				throw new NotFoundException('您还不是分销用户');
			}
		}

		return {
			id: distributor.id,
			distributor_code: distributor.distributor_code,
			qr_code_url: distributor.qr_code_url,
			status: distributor.status,
			total_earnings: distributor.total_earnings,
			withdrawable_amount: distributor.withdrawable_amount,
			subordinate_count: distributor.subordinate_count,
			total_orders: distributor.total_orders,
			is_app_admin: isAppAdmin,
		};
	}

	/**
	 * 获取分销统计数据
	 */
	async getDistributorStats(userId: number) {
		const distributor = await this.distributorRepository.findOne({
			where: { user_id: userId },
		});

		if (!distributor) {
			throw new NotFoundException('您还不是分销用户');
		}

		// 获取下级用户列表
		const relations = await this.distributionRelationRepository.find({
			where: { distributor_id: distributor.id },
			order: { create_time: 'DESC' },
			take: 100, // 最多返回100个
		});

		// 获取收益记录
		const orders = await this.distributionOrderRepository.find({
			where: { distributor_id: distributor.id },
			order: { create_time: 'DESC' },
			take: 50, // 最多返回50条
		});

		return {
			distributor: {
				total_earnings: distributor.total_earnings,
				withdrawable_amount: distributor.withdrawable_amount,
				subordinate_count: distributor.subordinate_count,
				total_orders: distributor.total_orders,
			},
			subordinates: relations.map((r) => ({
				user_id: r.user_id,
				level: r.level,
				create_time: r.create_time,
			})),
			commissions: orders.map((o) => ({
				order_id: o.order_id,
				buyer_id: o.buyer_id,
				level: o.level,
				order_amount: o.order_amount,
				commission_rate: o.commission_rate,
				commission_amount: o.commission_amount,
				status: o.status,
				create_time: o.create_time,
			})),
		};
	}

	/**
	 * 获取分销用户列表（后台管理）
	 */
	async getDistributorList(status?: number, page: number = 1, pageSize: number = 20) {
		// 确保 page 和 pageSize 是有效的数字
		const validPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
		const validPageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 20;

		const where: any = {};
		if (status !== undefined && status !== null) {
			const validStatus = Number(status);
			if (Number.isSafeInteger(validStatus) && validStatus >= 0 && validStatus <= 3) {
				where.status = validStatus;
			}
		}

		const [distributors, total] = await this.distributorRepository.findAndCount({
			where,
			relations: ['user'],
			order: { create_time: 'DESC' },
			skip: (validPage - 1) * validPageSize,
			take: validPageSize,
		});

		return {
			list: distributors.map((d) => ({
				id: d.id,
				user_id: d.user_id,
				user_nickname: d.user?.nickname,
				distributor_code: d.distributor_code,
				status: d.status,
				total_earnings: d.total_earnings,
				withdrawable_amount: d.withdrawable_amount,
				subordinate_count: d.subordinate_count,
				total_orders: d.total_orders,
				create_time: d.create_time,
			})),
			total,
			page: validPage,
			pageSize: validPageSize,
		};
	}

	/**
	 * 更新分销用户状态（后台管理）
	 */
	async updateDistributorStatus(id: number, dto: UpdateDistributorStatusDto) {
		const distributor = await this.distributorRepository.findOne({
			where: { id },
		});

		if (!distributor) {
			throw new NotFoundException('分销用户不存在');
		}

		distributor.status = dto.status;
		if (dto.status === 2 && dto.reject_reason) {
			distributor.reject_reason = dto.reject_reason;
		}

		await this.distributorRepository.save(distributor);

		return { message: '状态更新成功' };
	}

	/**
	 * 更新分销配置（后台管理）
	 */
	async updateDistributionConfig(dto: UpdateDistributionConfigDto) {
		let config = await this.distributionConfigRepository.findOne({
			where: { id: 1 },
		});

		if (!config) {
			config = this.distributionConfigRepository.create({ id: 1 });
		}

		if (dto.max_level !== undefined) {
			config.max_level = dto.max_level;
		}
		if (dto.commission_rates !== undefined) {
			config.commission_rates = dto.commission_rates;
		}
		if (dto.min_withdraw_amount !== undefined) {
			config.min_withdraw_amount = dto.min_withdraw_amount;
		}
		if (dto.is_enabled !== undefined) {
			config.is_enabled = dto.is_enabled;
		}
		if (dto.description !== undefined) {
			config.description = dto.description;
		}

		await this.distributionConfigRepository.save(config);

		return { message: '配置更新成功', config };
	}

	/**
	 * 获取分销统计数据（后台管理）
	 */
	async getAdminStats() {
		const totalDistributors = await this.distributorRepository.count();
		const approvedDistributors = await this.distributorRepository.count({
			where: { status: 1 },
		});
		const totalRelations = await this.distributionRelationRepository.count();
		const totalCommissions = await this.distributionOrderRepository
			.createQueryBuilder('do')
			.select('SUM(do.commission_amount)', 'total')
			.where('do.status = :status', { status: 1 })
			.getRawOne();

		return {
			total_distributors: totalDistributors,
			approved_distributors: approvedDistributors,
			total_relations: totalRelations,
			total_commissions: Number(totalCommissions?.total || 0),
		};
	}

	/**
	 * 购买激活码（分销商）
	 */
	async buyActivationCodes(userId: number, courseId: number, count: number) {
		const normalizedCount = Number(count);
		if (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > 1000) {
			throw new BadRequestException('购买数量需为 1～1000 的整数');
		}
		// 检查是否是分销商且状态为已通过
		const distributor = await this.distributorRepository.findOne({
			where: { user_id: userId },
		});

		if (!distributor) {
			throw new BadRequestException('您还不是分销用户');
		}

		if (distributor.status !== 1) {
			throw new BadRequestException('您的分销申请尚未通过审核');
		}

		// 检查课程是否存在
		const course = await this.courseRepository.findOne({
			where: { id: courseId },
		});

		if (!course) {
			throw new NotFoundException('课程不存在');
		}

		// 获取代理商价格（如果有），否则使用原价
		const agentPrice = Number(course.agent_price || course.price || 0);
		const totalPrice = agentPrice * normalizedCount;
		if (totalPrice <= 0) {
			throw new BadRequestException('激活码购买金额异常，请检查课程代理商售价');
		}

			const batchPrefix = 'DST';
			const batchId = `${batchPrefix}${distributor.distributor_code}${Date.now()}`;
		const order = this.orderRepository.create({
			order_no: this.generateActivationCodeOrderNo(),
			user_id: userId,
			course_id: courseId,
			amount: totalPrice,
			original_amount: totalPrice,
			status: OrderStatus.PENDING,
			pay_provider: 'virtual_payment',
			pay_payload: {
				activation_code_purchase: {
					distributor_id: distributor.id,
					distributor_code: distributor.distributor_code,
						batch_id: batchId,
						batch_prefix: batchPrefix,
						source_type: ActivationCodeSourceType.DISTRIBUTOR,
						source_id: distributor.id,
						course_id: courseId,
					course_name: course.name,
					count: normalizedCount,
					unit_price: agentPrice,
					total_price: totalPrice,
				},
			},
		});
		await this.orderRepository.save(order);

		const payment = await this.orderService.startCoinPaymentForOrder(userId, order.order_no, undefined, {
			goodsTitle: `${course.name}-激活码`,
		});

		return {
			order_no: order.order_no,
			batch_id: batchId,
			batch_no: batchId, // 兼容前端
			count: normalizedCount,
			course_id: courseId,
			course_name: course.name,
			total_price: totalPrice,
			payment_params: payment.payment_params,
		};
	}

	async fulfillActivationCodeOrder(order: Order) {
		const payload = order.pay_payload?.activation_code_purchase;
		if (!payload) {
			return { message: '非激活码订单' };
		}

		const existingCount = await this.activationCodeRepository.count({
			where: {
				batch_id: payload.batch_id,
				agent_id: payload.distributor_id,
			},
		});
		if (existingCount > 0) {
			return {
				message: '激活码已生成',
				batch_no: payload.batch_id,
				count: existingCount,
			};
		}

		const codes = [];
		for (let i = 0; i < Number(payload.count || 0); i++) {
			codes.push(
				this.activationCodeRepository.create({
					code: this.generateActivationCode(),
					course_id: payload.course_id,
						batch_id: payload.batch_id,
						batch_prefix: payload.batch_prefix || this.getBatchPrefix(payload.batch_id),
						agent_id: payload.distributor_id,
						source_type: ActivationCodeSourceType.DISTRIBUTOR,
						source_id: payload.distributor_id,
						status: ActivationCodeStatus.PENDING,
					}),
				);
		}
		await this.activationCodeRepository.save(codes);

		return {
			message: '激活码生成成功',
			batch_no: payload.batch_id,
			count: codes.length,
		};
	}

	/**
	 * 获取分销商购买的激活码列表
	 */
		async getDistributorCodes(userId: number, page = 1, pageSize = 20, batchId?: string, status?: number) {
		// 校验分页参数，避免 NaN 传入 TypeORM
		const validPage = Number.isFinite(page) && Number.isInteger(page) && page > 0 ? page : 1;
		const validPageSize =
			Number.isFinite(pageSize) && Number.isInteger(pageSize) && pageSize > 0 ? Math.min(100, pageSize) : 20;

			const appUser = await this.appUserRepository.findOne({ where: { id: userId } });
			const isAppAdmin = appUser?.role === AppUserRole.ADMIN;

			// 检查是否是分销商
			const distributor = await this.distributorRepository.findOne({
				where: { user_id: userId },
			});

			if (!distributor && !isAppAdmin) {
				throw new BadRequestException('您还不是分销用户');
			}

			const queryBuilder = this.activationCodeRepository.createQueryBuilder('code');

			if (isAppAdmin) {
				queryBuilder.where('code.source_type = :sourceType', { sourceType: ActivationCodeSourceType.APP_ADMIN });
			} else {
				// 只查询该分销商购买的激活码（通过 agent_id 关联）
				queryBuilder.where('code.agent_id = :agentId', { agentId: distributor.id });
			}

		// 批次号筛选
		if (batchId && batchId.trim() !== '') {
			queryBuilder.andWhere('code.batch_id = :batchId', { batchId: batchId.trim() });
		}

		// 状态筛选（仅当 status 为有效数字时添加）
		if (status !== undefined && status !== null && Number.isInteger(status) && !Number.isNaN(status) && status >= 0) {
			queryBuilder.andWhere('code.status = :status', { status });
		}

		// 关联课程信息
		queryBuilder.leftJoinAndSelect('code.course', 'course').orderBy('code.create_time', 'DESC');

		const [codes, total] = await queryBuilder
			.skip((validPage - 1) * validPageSize)
			.take(validPageSize)
			.getManyAndCount();

		// 统计激活码数量（不限制分页，统计所有数据）
			const statsQueryBuilder = this.activationCodeRepository.createQueryBuilder('code');
			if (isAppAdmin) {
				statsQueryBuilder.where('code.source_type = :sourceType', { sourceType: ActivationCodeSourceType.APP_ADMIN });
			} else {
				statsQueryBuilder.where('code.agent_id = :agentId', { agentId: distributor.id });
			}

			const allCodes = await statsQueryBuilder.getMany();
			const totalCount = allCodes.length;
			const usedCount = allCodes.filter((c) => c.status === ActivationCodeStatus.USED).length;
			const pendingCount = allCodes.filter((c) => c.status === ActivationCodeStatus.PENDING).length;
			const invalidCount = allCodes.filter((c) => c.status === ActivationCodeStatus.INVALID).length;

		// 获取使用激活码的用户信息
		const usedUserIds = codes.filter((c) => c.used_by_uid).map((c) => c.used_by_uid);
		const usedUsers =
			usedUserIds.length > 0
				? await this.appUserRepository.find({
						where: { id: In(usedUserIds) },
					})
				: [];
		const userMap = new Map(usedUsers.map((u) => [u.id, u]));
		const packagePlanIds = Array.from(
			new Set(
				codes
					.filter((code) => (code.target_type || ActivationCodeTargetType.COURSE) === ActivationCodeTargetType.PACKAGE && code.target_id)
					.map((code) => code.target_id),
			),
		);
		const packagePlans =
			packagePlanIds.length > 0
				? await this.packagePlanRepository.find({ where: { id: In(packagePlanIds) }, relations: ['section'] })
				: [];
		const packagePlanMap = new Map(packagePlans.map((plan) => [plan.id, plan]));

		// 格式化返回数据
		return {
			list: codes.map((code) => {
				const targetType = code.target_type || ActivationCodeTargetType.COURSE;
				const plan = targetType === ActivationCodeTargetType.PACKAGE && code.target_id ? packagePlanMap.get(code.target_id) : null;
				const targetName = plan ? `${plan.section?.name || '套餐/VIP'} - ${plan.name}` : code.course?.name || '-';
				return {
					id: code.id,
					code: code.code,
					batch_id: code.batch_id,
					batch_prefix: code.batch_prefix || this.getBatchPrefix(code.batch_id),
					source_type: code.source_type,
					source_text: this.getSourceText(code),
					target_type: targetType,
					target_type_text: targetType === ActivationCodeTargetType.PACKAGE ? '套餐/VIP' : '课程',
					target_id: code.target_id || code.course_id,
					target_name: targetName,
					course_id: code.course_id,
					course_name: targetName,
					status: code.status,
					status_text:
						code.status === ActivationCodeStatus.PENDING
							? '待用'
							: code.status === ActivationCodeStatus.USED
								? '已用'
								: '作废',
					used_by_uid: code.used_by_uid,
					used_by_name: code.used_by_uid ? userMap.get(code.used_by_uid)?.nickname || '未知用户' : null,
					used_time: code.used_time,
					create_time: code.create_time,
				};
			}),
			total,
			page: validPage,
			pageSize: validPageSize,
			stats: {
					total_count: totalCount,
					used_count: usedCount,
					pending_count: pendingCount,
					invalid_count: invalidCount,
				},
			};
		}

		async generateAdminActivationCodes(
			userId: number,
			input:
				| {
						course_id?: number;
						count: number;
						target_type?: ActivationCodeTargetType;
						target_id?: number;
				  }
				| number,
			legacyCount?: number,
		) {
			const appUser = await this.appUserRepository.findOne({ where: { id: userId } });
			if (appUser?.role !== AppUserRole.ADMIN) {
				throw new BadRequestException('仅小程序管理员可以生成激活码');
			}

			const payload =
				typeof input === 'number'
					? { course_id: input, count: legacyCount || 0, target_type: ActivationCodeTargetType.COURSE }
					: input;
			const normalizedCount = Number(payload.count);
			if (!Number.isInteger(normalizedCount) || normalizedCount < 1) {
				throw new BadRequestException('生成数量需为大于 0 的整数');
			}

			const target = await this.resolveAppAdminActivationTarget(payload);

			const batchPrefix = 'APP';
			const batchId = `${batchPrefix}${userId}${Date.now()}`;
			const codes = Array.from({ length: normalizedCount }, () =>
				this.activationCodeRepository.create({
					code: this.generateActivationCode(),
					course_id: target.courseId,
					target_type: target.type,
					target_id: target.id,
					batch_id: batchId,
					batch_prefix: batchPrefix,
					agent_id: null,
					source_type: ActivationCodeSourceType.APP_ADMIN,
					source_id: userId,
					status: ActivationCodeStatus.PENDING,
				}),
			);
			await this.activationCodeRepository.save(codes);

			return {
				message: '激活码生成成功',
				batch_no: batchId,
				batch_id: batchId,
				count: codes.length,
				target_type: target.type,
				target_id: target.id,
				course_id: target.courseId,
				course_name: target.name,
				target_name: target.name,
			};
		}

		private async resolveAppAdminActivationTarget(input: {
			course_id?: number;
			target_type?: ActivationCodeTargetType;
			target_id?: number;
		}) {
			const type = input.target_type || ActivationCodeTargetType.COURSE;
			const id = Number(input.target_id || input.course_id);
			if (!Number.isInteger(id) || id <= 0) {
				throw new BadRequestException(type === ActivationCodeTargetType.PACKAGE ? '请选择套餐/VIP计划' : '请选择课程');
			}

			if (type === ActivationCodeTargetType.PACKAGE) {
				const plan = await this.packagePlanRepository.findOne({ where: { id }, relations: ['section'] });
				if (!plan || plan.status === 0) {
					throw new NotFoundException('套餐计划不存在或已禁用');
				}
				if (!plan.section || plan.section.status === 0) {
					throw new NotFoundException('套餐不存在或已禁用');
				}
				return {
					type,
					id: plan.id,
					courseId: null,
					name: `${plan.section.name} - ${plan.name}`,
				};
			}

			const course = await this.courseRepository.findOne({ where: { id } });
			if (!course) {
				throw new NotFoundException('课程不存在');
			}
			return {
				type: ActivationCodeTargetType.COURSE,
				id: course.id,
				courseId: course.id,
				name: course.name,
			};
		}

		async invalidateAppActivationCode(userId: number, codeId: number) {
			const appUser = await this.appUserRepository.findOne({ where: { id: userId } });
			const isAppAdmin = appUser?.role === AppUserRole.ADMIN;
			const distributor = isAppAdmin
				? null
				: await this.distributorRepository.findOne({
						where: { user_id: userId },
					});

			if (!isAppAdmin && !distributor) {
				throw new BadRequestException('您还不是分销用户');
			}

			const queryRunner = this.dataSource.createQueryRunner();
			await queryRunner.connect();
			await queryRunner.startTransaction();

			try {
				const queryBuilder = queryRunner.manager
					.createQueryBuilder(ActivationCode, 'code')
					.setLock('pessimistic_write')
					.where('code.id = :codeId', { codeId });

				if (!isAppAdmin) {
					queryBuilder.andWhere('code.agent_id = :agentId', { agentId: distributor.id });
				}

				const code = await queryBuilder.getOne();
				if (!code) {
					throw new BadRequestException('激活码不存在');
				}
				if (code.status !== ActivationCodeStatus.USED || !code.used_by_uid) {
					throw new BadRequestException('只能禁用已激活的激活码');
				}

				code.status = ActivationCodeStatus.INVALID;
				await queryRunner.manager.save(ActivationCode, code);
				await this.revokeCodeCourseAuth(queryRunner.manager, code);
				await queryRunner.commitTransaction();

				return { success: true };
			} catch (error) {
				await queryRunner.rollbackTransaction();
				throw error;
			} finally {
				await queryRunner.release();
			}
		}

	/**
	 * 生成随机激活码
	 */
	private generateActivationCode(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除容易混淆的字符
		let code = '';
		for (let i = 0; i < 12; i++) {
			if (i > 0 && i % 4 === 0) {
				code += '-';
			}
			code += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return code;
	}

		private generateActivationCodeOrderNo(): string {
			const timestamp = Date.now();
			const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
			return `AC${timestamp}${random}`;
		}

		private async revokeCodeCourseAuth(manager: any, code: ActivationCode) {
			if (!code.used_by_uid) return;

			const paidOrder = await manager.findOne(Order, {
				where: {
					user_id: code.used_by_uid,
					course_id: code.course_id,
					status: OrderStatus.PAID,
				},
			});
			if (paidOrder) return;

			const otherUsedCodeCount = await manager.count(ActivationCode, {
				where: {
					used_by_uid: code.used_by_uid,
					course_id: code.course_id,
					status: ActivationCodeStatus.USED,
				},
			});
			if (otherUsedCodeCount > 0) return;

			await manager.delete(UserCourseAuth, {
				user_id: code.used_by_uid,
				course_id: code.course_id,
				source: AuthSource.CODE,
			});
		}

		private getBatchPrefix(batchId?: string) {
			if (!batchId) return '-';
			if (batchId.startsWith('DST')) return 'DST';
			if (batchId.startsWith('APP')) return 'APP';
			if (batchId.startsWith('ADM')) return 'ADM';
			if (batchId.startsWith('AGT')) return 'AGT';
			if (batchId.startsWith('D')) return 'D';
			return 'BATCH';
		}

		private getSourceText(code: ActivationCode) {
			const sourceType =
				code.source_type ||
				(code.batch_id?.startsWith('D') ? ActivationCodeSourceType.DISTRIBUTOR : ActivationCodeSourceType.ADMIN);
			const textMap: Record<string, string> = {
				[ActivationCodeSourceType.ADMIN]: '管理端生成',
				[ActivationCodeSourceType.AGENT]: '代理商生成',
				[ActivationCodeSourceType.DISTRIBUTOR]: '分销购买',
				[ActivationCodeSourceType.APP_ADMIN]: '小程序管理员生成',
			};
			return textMap[sourceType] || '未知来源';
		}
	}
