import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as https from 'https';
import { Distributor } from '../../database/entities/distributor.entity';
import { DistributionRelation } from '../../database/entities/distribution-relation.entity';
import { DistributionOrder } from '../../database/entities/distribution-order.entity';
import { DistributionConfig } from '../../database/entities/distribution-config.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { ActivationCode, ActivationCodeStatus } from '../../database/entities/activation-code.entity';
import { Course } from '../../database/entities/course.entity';
import { UpdateDistributorStatusDto } from './dto/update-distributor-status.dto';
import { UpdateDistributionConfigDto } from './dto/update-distribution-config.dto';
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
		private configService: ConfigService,
		@Inject(forwardRef(() => UploadService))
		private uploadService: UploadService,
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
	async generateQRCode(userId: number) {
		const distributor = await this.distributorRepository.findOne({
			where: { user_id: userId },
		});

		if (!distributor) {
			throw new NotFoundException('您还不是分销用户');
		}

		if (distributor.status !== 1) {
			throw new BadRequestException('您的分销资格尚未通过审核');
		}

		// 如果已有二维码，直接返回
		if (distributor.qr_code_url) {
			return {
				qr_code_url: distributor.qr_code_url,
				distributor_code: distributor.distributor_code,
			};
		}

		// 调用微信小程序生成二维码接口
		const appid = this.configService.get('WECHAT_APPID');
		const secret = this.configService.get('WECHAT_SECRET');

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

		// 使用 getUnlimited 接口生成小程序码（数量无限制）
		const response = await axios.post(
			`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`,
			{
				scene: distributorCode, // 场景值，传递分销商编号
				page: 'pages/index/index', // 扫码后跳转的页面（首页）
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
		if (contentType.includes('application/json') || contentType.includes('text/')) {
			// 尝试解析为 JSON 错误信息
			try {
				const errorData = JSON.parse(Buffer.from(response.data).toString('utf-8'));
				if (errorData.errcode) {
					this.logger.error('微信生成二维码失败:', errorData);
					throw new BadRequestException(
						`生成二维码失败: ${errorData.errmsg || '未知错误'} (错误码: ${errorData.errcode})`,
					);
				}
			} catch (e) {
				// 如果不是 JSON，继续处理
			}
		}

		// 将二维码图片上传到 COS 或保存到本地
		try {
			// 创建一个模拟的 Multer File 对象用于上传
			const fileBuffer = Buffer.from(response.data);
			const mockFile: Express.Multer.File = {
				fieldname: 'qrcode',
				originalname: `qrcode_${distributorCode}_${Date.now()}.png`,
				encoding: '7bit',
				mimetype: 'image/png',
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
		const distributor = await this.distributorRepository.findOne({
			where: { user_id: userId },
			relations: ['user'],
		});

		if (!distributor) {
			throw new NotFoundException('您还不是分销用户');
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
		const agentPrice = course.agent_price || course.price || 0;
		const totalPrice = agentPrice * count;

		// 这里可以添加支付逻辑，暂时直接生成激活码
		// 生成批次ID
		const batchId = `D${distributor.distributor_code}${Date.now()}`;

		// 生成激活码
		const codes = [];
		for (let i = 0; i < count; i++) {
			const code = this.generateActivationCode();
			codes.push(
				this.activationCodeRepository.create({
					code,
					course_id: courseId,
					batch_id: batchId,
					agent_id: distributor.id, // 使用分销商ID作为代理商ID
					status: ActivationCodeStatus.PENDING,
				}),
			);
		}

		await this.activationCodeRepository.save(codes);

		// 这里可以创建订单记录（如果需要）
		// 暂时直接返回结果

		return {
			batch_id: batchId,
			batch_no: batchId, // 兼容前端
			count: codes.length,
			course_id: courseId,
			course_name: course.name,
			total_price: totalPrice,
			codes: codes.map((c) => c.code), // 返回激活码列表
		};
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
}
