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
	ActivationCodeRewardPayload,
	ActivationCodeSourceType,
	ActivationCodeStatus,
	ActivationCodeTargetType,
} from '../../database/entities/activation-code.entity';
import { Course } from '../../database/entities/course.entity';
import { PackagePlan } from '../../database/entities/package-plan.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { UserCategoryBundleAccess } from '../../database/entities/user-category-bundle-access.entity';
import { UserCourseAuth, AuthSource } from '../../database/entities/user-course-auth.entity';
import { UpdateDistributorStatusDto } from './dto/update-distributor-status.dto';
import { UpdateDistributionConfigDto } from './dto/update-distribution-config.dto';
import { OrderService } from '../order/order.service';
import { UploadService } from '../upload/upload.service';
import { AgentPricePolicyService } from './agent-price-policy.service';
import {
	DistributorWithdrawal,
	DistributorWithdrawalStatus,
} from '../../database/entities/distributor-withdrawal.entity';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

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
		@InjectRepository(DistributorWithdrawal)
		private distributorWithdrawalRepository: Repository<DistributorWithdrawal>,
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
		@InjectRepository(CourseCategory)
		private courseCategoryRepository: Repository<CourseCategory>,
		private configService: ConfigService,
		@Inject(forwardRef(() => OrderService))
		private orderService: OrderService,
			@Inject(forwardRef(() => UploadService))
			private uploadService: UploadService,
			private dataSource: DataSource,
			private agentPricePolicyService: AgentPricePolicyService,
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
			if (existing.status === 3) {
				throw new BadRequestException('代理资格已被禁用，请联系客服处理');
			}
			existing.status = 1;
			existing.agent_level = this.normalizeAgentLevel(existing.agent_level);
			existing.reject_reason = null;
			await this.distributorRepository.save(existing);
			await this.evaluateUplinePromotion(userId);
			return { message: '已免费开通初级代理', distributor_code: existing.distributor_code, agent_level: existing.agent_level };
		}

		// 生成分销商编号
		const distributorCode = this.generateDistributorCode(userId);

		// 创建分销用户
		const distributor = this.distributorRepository.create({
			user_id: userId,
			distributor_code: distributorCode,
			status: 1,
			agent_level: 1,
		});

		await this.distributorRepository.save(distributor);
		await this.evaluateUplinePromotion(userId);

		return {
			message: '已免费开通初级代理',
			distributor_code: distributorCode,
			agent_level: 1,
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

		const chain = await this.getDistributorChain(order.user_id, 3);
		if (chain.length === 0) {
			this.logger.log(`订单 ${orderId} 没有分销关系，无需分成`);
			return;
		}
		const config = await this.getDistributionConfig();
		const paidAt = order.paid_time || new Date();
		const availableAt = new Date(paidAt.getTime() + Number(config.commission_freeze_days || 15) * 86400000);
		const entries: Array<{ distributor: Distributor; type: DistributionOrder['commission_type']; rate: number; amount: number; level: number }> = [];
		if (this.isPaperOrder(order)) {
			const kindCount = this.getPaperKindCount(order);
			const amount = this.roundMoney(kindCount * Number(config.paper_commission_per_kind || 1));
			if (amount > 0) entries.push({ distributor: chain[0], type: 'paper', rate: 0, amount, level: 1 });
		} else {
			const baseRates = this.normalizeRates(config.base_commission_rates, [20, 25, 30]);
			const directRates = this.normalizeRates(config.direct_commission_rates, [5, 6, 8]);
			const indirectRates = this.normalizeRates(config.indirect_commission_rates, [0, 3, 4]);
			const orderAmount = Number(order.amount || 0);
			const rates = [
				baseRates[this.normalizeAgentLevel(chain[0].agent_level) - 1],
				chain[1] ? directRates[this.normalizeAgentLevel(chain[1].agent_level) - 1] : 0,
				chain[2] ? indirectRates[this.normalizeAgentLevel(chain[2].agent_level) - 1] : 0,
			];
			const types: DistributionOrder['commission_type'][] = ['base', 'direct_team', 'indirect_team'];
			for (let index = 0; index < Math.min(chain.length, 3); index += 1) {
				const rate = Number(rates[index] || 0);
				const amount = this.roundMoney((orderAmount * rate) / 100);
				if (rate > 0 && amount > 0) entries.push({ distributor: chain[index], type: types[index], rate, amount, level: index + 1 });
			}
		}

		await this.dataSource.transaction(async (manager) => {
			for (const entry of entries) {
				const repository = manager.getRepository(DistributionOrder);
				const existing = await repository.findOne({
					where: { order_id: orderId, distributor_id: entry.distributor.id, commission_type: entry.type },
				});
				if (existing) continue;
				await repository.save(repository.create({
					order_id: orderId,
					distributor_id: entry.distributor.id,
					buyer_id: order.user_id,
					level: entry.level,
					order_amount: Number(order.amount || 0),
					commission_rate: entry.rate,
					commission_amount: entry.amount,
					commission_type: entry.type,
					status: 0,
					available_at: availableAt,
				}));
				await manager.increment(Distributor, { id: entry.distributor.id }, 'total_earnings', entry.amount);
				await manager.increment(Distributor, { id: entry.distributor.id }, 'frozen_amount', entry.amount);
				await manager.increment(Distributor, { id: entry.distributor.id }, 'total_orders', 1);
			}
		});

		this.logger.log(`订单 ${orderId} 分成处理完成，共 ${entries.length} 笔`);
	}

	/**
	 * 获取分销关系链（从用户到所有上级）
	 */
	private async getDistributorChain(userId: number, maxDepth: number): Promise<Distributor[]> {
		const distributors: Distributor[] = [];
		let currentUserId = userId;
		for (let i = 0; i < maxDepth; i++) {
			const relation = await this.distributionRelationRepository.findOne({
				where: { user_id: currentUserId },
			});
			if (!relation) break;
			const distributor = await this.distributorRepository.findOne({
				where: { id: relation.distributor_id },
			});
			if (!distributor || distributor.status !== 1) break;
			distributors.push(distributor);
			currentUserId = distributor.user_id;
		}
		return distributors;
	}

	private normalizeRates(value: unknown, fallback: number[]) {
		return Array.isArray(value) && value.length >= 3 ? value.map((item) => Number(item || 0)) : fallback;
	}

	private roundMoney(value: number) {
		return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
	}

	private isPaperOrder(order: Order) {
		const items = Array.isArray(order.pay_payload?.cart_items) ? order.pay_payload.cart_items : [];
		return order.pay_payload?.fulfillment_type === 'paper' || items.some((item) => item?.content_type === 'paper_exam' || item?.contentType === 'paper_exam');
	}

	private getPaperKindCount(order: Order) {
		const items = Array.isArray(order.pay_payload?.cart_items) ? order.pay_payload.cart_items : [];
		if (!items.length) return 1;
		const keys = new Set(items.map((item, index) => String(item?.course_id || item?.courseId || item?.id || index)));
		return Math.max(1, keys.size);
	}

	private async evaluateUplinePromotion(activatedUserId: number) {
		let currentUserId = activatedUserId;
		for (let depth = 0; depth < 10; depth += 1) {
			const relation = await this.distributionRelationRepository.findOne({ where: { user_id: currentUserId } });
			if (!relation) break;
			const upline = await this.distributorRepository.findOne({ where: { id: relation.distributor_id } });
			if (!upline || upline.status !== 1) break;
			const directRelations = await this.distributionRelationRepository.find({ where: { distributor_id: upline.id } });
			const directUserIds = directRelations.map((item) => item.user_id);
			const directAgents = directUserIds.length
				? await this.distributorRepository.find({ where: { user_id: In(directUserIds), status: 1 } })
				: [];
			const juniorCount = directAgents.filter((item) => this.normalizeAgentLevel(item.agent_level) === 1).length;
			const middleCount = directAgents.filter((item) => this.normalizeAgentLevel(item.agent_level) === 2).length;
			let nextLevel = this.normalizeAgentLevel(upline.agent_level);
			if (juniorCount >= 30 || middleCount >= 5) nextLevel = 3;
			else if (juniorCount >= 15 && nextLevel < 2) nextLevel = 2;
			if (nextLevel > this.normalizeAgentLevel(upline.agent_level)) {
				upline.agent_level = nextLevel;
				await this.distributorRepository.save(upline);
			}
			currentUserId = upline.user_id;
		}
	}

	private async settleAvailableCommissions(distributorId: number) {
		const due = await this.distributionOrderRepository
			.createQueryBuilder('commission')
			.where('commission.distributor_id = :distributorId', { distributorId })
			.andWhere('commission.status = 0')
			.andWhere('commission.available_at IS NOT NULL')
			.andWhere('commission.available_at <= :now', { now: new Date() })
			.getMany();
		if (!due.length) return;
		const orders = await this.orderRepository.find({ where: { id: In(due.map((item) => item.order_id)) } });
		const orderStatus = new Map(orders.map((item) => [item.id, item.status]));
		await this.dataSource.transaction(async (manager) => {
			for (const commission of due) {
				if (orderStatus.get(commission.order_id) !== OrderStatus.PAID) {
					commission.status = 2;
					await manager.getRepository(DistributionOrder).save(commission);
					await manager.decrement(Distributor, { id: distributorId }, 'frozen_amount', Number(commission.commission_amount));
					await manager.decrement(Distributor, { id: distributorId }, 'total_earnings', Number(commission.commission_amount));
					continue;
				}
				commission.status = 1;
				commission.settle_time = new Date();
				await manager.getRepository(DistributionOrder).save(commission);
				await manager.decrement(Distributor, { id: distributorId }, 'frozen_amount', Number(commission.commission_amount));
				await manager.increment(Distributor, { id: distributorId }, 'withdrawable_amount', Number(commission.commission_amount));
			}
		});
	}

	async cancelOrderCommission(orderId: number) {
		await this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(DistributionOrder);
			const commissions = await repository.find({ where: { order_id: orderId } });
			for (const commission of commissions.filter((item) => item.status !== 2)) {
				const amount = Number(commission.commission_amount || 0);
				await manager.decrement(Distributor, { id: commission.distributor_id }, 'total_earnings', amount);
				if (commission.status === 0) {
					await manager.decrement(Distributor, { id: commission.distributor_id }, 'frozen_amount', amount);
				} else {
					await manager.decrement(Distributor, { id: commission.distributor_id }, 'withdrawable_amount', amount);
				}
				commission.status = 2;
				await repository.save(commission);
			}
		});
	}

	async createWithdrawal(userId: number, dto: CreateWithdrawalDto) {
		const distributor = await this.distributorRepository.findOne({ where: { user_id: userId } });
		if (!distributor || distributor.status !== 1) throw new BadRequestException('请先免费开通代理');
		await this.settleAvailableCommissions(distributor.id);
		const fresh = await this.distributorRepository.findOne({ where: { id: distributor.id } });
		const config = await this.getDistributionConfig();
		const amount = this.roundMoney(dto.amount);
		const minimum = Number(config.min_withdraw_amount || 100);
		const reserve = Number(config.withdraw_reserve_amount || 20);
		if (amount < minimum) throw new BadRequestException(`最低提现金额为 ${minimum} 元`);
		if (Number(fresh.withdrawable_amount || 0) - amount < reserve) {
			throw new BadRequestException(`提现后账户至少需要保留 ${reserve} 元`);
		}
		const alipayAccount = String(dto.alipay_account || '').trim();
		const realName = String(dto.real_name || '').trim();
		if (!alipayAccount || !realName) throw new BadRequestException('请填写支付宝账号与真实姓名');
		const feeAmount = this.roundMoney((amount * Number(config.withdraw_fee_rate || 5)) / 100);
		const payoutAmount = this.roundMoney(amount - feeAmount);
		return this.dataSource.transaction(async (manager) => {
			await manager.decrement(Distributor, { id: distributor.id }, 'withdrawable_amount', amount);
			await manager.update(Distributor, { id: distributor.id }, { alipay_account: alipayAccount, real_name: realName });
			const repository = manager.getRepository(DistributorWithdrawal);
			const withdrawal = await repository.save(repository.create({
				distributor_id: distributor.id,
				amount,
				fee_amount: feeAmount,
				payout_amount: payoutAmount,
				alipay_account: alipayAccount,
				real_name: realName,
				status: DistributorWithdrawalStatus.PENDING,
			}));
			return { ...withdrawal, message: '提现申请已提交，等待人工打款' };
		});
	}

	async getWithdrawals(userId: number) {
		const distributor = await this.distributorRepository.findOne({ where: { user_id: userId } });
		if (!distributor) return [];
		return this.distributorWithdrawalRepository.find({ where: { distributor_id: distributor.id }, order: { create_time: 'DESC' }, take: 100 });
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
		const contentType = String(response.headers['content-type'] || '');
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

		// 将二维码图片上传到 OSS 或保存到本地
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
			agent_level: 1,
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
				commission_rates: [20, 25, 30],
				base_commission_rates: [20, 25, 30],
				direct_commission_rates: [5, 6, 8],
				indirect_commission_rates: [0, 3, 4],
				min_withdraw_amount: 100,
				withdraw_reserve_amount: 20,
				withdraw_fee_rate: 5,
				commission_freeze_days: 15,
				paper_commission_per_kind: 1,
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
				return null;
			}
		}
		await this.settleAvailableCommissions(distributor.id);
		distributor = await this.distributorRepository.findOne({ where: { id: distributor.id }, relations: ['user'] });
		const config = await this.getDistributionConfig();
		const directRelations = await this.distributionRelationRepository.find({ where: { distributor_id: distributor.id } });
		const directUserIds = directRelations.map((item) => item.user_id);
		const directAgents = directUserIds.length ? await this.distributorRepository.find({ where: { user_id: In(directUserIds), status: 1 } }) : [];
		const juniorCount = directAgents.filter((item) => this.normalizeAgentLevel(item.agent_level) === 1).length;
		const middleCount = directAgents.filter((item) => this.normalizeAgentLevel(item.agent_level) === 2).length;

		return {
			id: distributor.id,
			distributor_code: distributor.distributor_code,
			qr_code_url: distributor.qr_code_url,
			status: distributor.status,
			total_earnings: distributor.total_earnings,
			withdrawable_amount: distributor.withdrawable_amount,
			frozen_amount: distributor.frozen_amount,
			subordinate_count: distributor.subordinate_count,
			total_orders: distributor.total_orders,
			is_app_admin: isAppAdmin,
			is_agent: distributor.status === 1,
			agent_level: this.normalizeAgentLevel(distributor.agent_level),
			agent_level_name: this.getAgentLevelName(distributor.agent_level),
			alipay_account: distributor.alipay_account,
			real_name: distributor.real_name,
			promotion: {
				direct_junior_count: juniorCount,
				direct_middle_count: middleCount,
				middle_target: 15,
				high_junior_target: 30,
				high_middle_target: 5,
			},
			withdraw_rules: {
				minimum: Number(config.min_withdraw_amount || 100),
				reserve: Number(config.withdraw_reserve_amount || 20),
				fee_rate: Number(config.withdraw_fee_rate || 5),
				freeze_days: Number(config.commission_freeze_days || 15),
			},
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
		await this.settleAvailableCommissions(distributor.id);
		const freshDistributor = await this.distributorRepository.findOne({ where: { id: distributor.id } });

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
				total_earnings: freshDistributor.total_earnings,
				withdrawable_amount: freshDistributor.withdrawable_amount,
				frozen_amount: freshDistributor.frozen_amount,
				subordinate_count: freshDistributor.subordinate_count,
				total_orders: freshDistributor.total_orders,
			},
			subordinates: relations.map((r) => ({
				user_id: r.user_id,
				level: r.level,
				create_time: r.create_time,
			})),
			commissions: orders.map((o) => ({
				id: o.id,
				order_id: o.order_id,
				buyer_id: o.buyer_id,
				level: o.level,
				order_amount: o.order_amount,
				commission_rate: o.commission_rate,
				commission_amount: o.commission_amount,
				commission_type: o.commission_type,
				status: o.status,
				available_at: o.available_at,
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
				agent_level: this.normalizeAgentLevel(d.agent_level),
				agent_level_name: this.getAgentLevelName(d.agent_level),
				total_earnings: d.total_earnings,
				withdrawable_amount: d.withdrawable_amount,
				frozen_amount: d.frozen_amount,
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
		if (dto.agent_level !== undefined) distributor.agent_level = this.normalizeAgentLevel(dto.agent_level);
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
		if (dto.base_commission_rates !== undefined) config.base_commission_rates = dto.base_commission_rates;
		if (dto.direct_commission_rates !== undefined) config.direct_commission_rates = dto.direct_commission_rates;
		if (dto.indirect_commission_rates !== undefined) config.indirect_commission_rates = dto.indirect_commission_rates;
		if (dto.min_withdraw_amount !== undefined) {
			config.min_withdraw_amount = dto.min_withdraw_amount;
		}
		if (dto.withdraw_reserve_amount !== undefined) config.withdraw_reserve_amount = dto.withdraw_reserve_amount;
		if (dto.withdraw_fee_rate !== undefined) config.withdraw_fee_rate = dto.withdraw_fee_rate;
		if (dto.commission_freeze_days !== undefined) config.commission_freeze_days = dto.commission_freeze_days;
		if (dto.paper_commission_per_kind !== undefined) config.paper_commission_per_kind = dto.paper_commission_per_kind;
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
		const levelRows = await this.distributorRepository
			.createQueryBuilder('distributor')
			.select('distributor.agent_level', 'level')
			.addSelect('COUNT(*)', 'count')
			.where('distributor.status = 1')
			.groupBy('distributor.agent_level')
			.getRawMany();

		return {
			total_distributors: totalDistributors,
			approved_distributors: approvedDistributors,
			total_relations: totalRelations,
			total_commissions: Number(totalCommissions?.total || 0),
			level_counts: levelRows.reduce((result, row) => ({ ...result, [String(row.level)]: Number(row.count || 0) }), {}),
		};
	}

	async getAdminWithdrawals(status?: number) {
		const where = status === undefined ? {} : { status: Number(status) as DistributorWithdrawalStatus };
		const list = await this.distributorWithdrawalRepository.find({ where, order: { create_time: 'DESC' }, take: 500 });
		const distributorIds = Array.from(new Set(list.map((item) => item.distributor_id)));
		const distributors = distributorIds.length ? await this.distributorRepository.find({ where: { id: In(distributorIds) }, relations: ['user'] }) : [];
		const map = new Map(distributors.map((item) => [item.id, item]));
		return list.map((item) => ({ ...item, user_id: map.get(item.distributor_id)?.user_id, user_nickname: map.get(item.distributor_id)?.user?.nickname }));
	}

	async updateWithdrawalStatus(id: number, status: DistributorWithdrawalStatus, adminId: number, remark?: string) {
		if (![DistributorWithdrawalStatus.PAID, DistributorWithdrawalStatus.REJECTED].includes(status)) {
			throw new BadRequestException('只允许标记已打款或驳回');
		}
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(DistributorWithdrawal);
			const withdrawal = await repository.findOne({ where: { id } });
			if (!withdrawal) throw new NotFoundException('提现申请不存在');
			if (withdrawal.status !== DistributorWithdrawalStatus.PENDING) throw new BadRequestException('该提现申请已处理');
			withdrawal.status = status;
			withdrawal.admin_id = adminId;
			withdrawal.remark = String(remark || '').trim() || null;
			withdrawal.processed_at = new Date();
			if (status === DistributorWithdrawalStatus.REJECTED) {
				await manager.increment(Distributor, { id: withdrawal.distributor_id }, 'withdrawable_amount', Number(withdrawal.amount));
			}
			await repository.save(withdrawal);
			return { message: status === DistributorWithdrawalStatus.PAID ? '已标记人工打款完成' : '已驳回并退回可提现余额', withdrawal };
		});
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

		const agentLevel = this.normalizeAgentLevel(distributor.agent_level);
		// 兼容旧版小程序：接口保留且仍可完成购买，但新订单统一按课程原价，不再应用代理价。
		const pricing = { unitPrice: Number(course.price || 0), excluded: true, pricingMode: 'original_compat' };
		const agentPrice = pricing.unitPrice;
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
					agent_level: agentLevel,
					agent_price_excluded: pricing.excluded,
					pricing_mode: pricing.pricingMode,
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
			agent_level: agentLevel,
			agent_level_name: this.getAgentLevelName(agentLevel),
			agent_price_excluded: pricing.excluded,
			pricing_mode: pricing.pricingMode,
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
		const categoryIds = Array.from(
			new Set(
				codes
					.filter((code) => code.target_type === ActivationCodeTargetType.CATEGORY_BUNDLE && code.target_id)
					.map((code) => code.target_id),
			),
		);
		const categories = categoryIds.length
			? await this.courseCategoryRepository.find({ where: { id: In(categoryIds) } })
			: [];
		const parentIds = Array.from(
			new Set(categories.map((item) => item.parent_id).filter((id): id is number => id !== null)),
		);
		const categoryParents = parentIds.length
			? await this.courseCategoryRepository.find({ where: { id: In(parentIds) } })
			: [];
		const categoryMap = new Map(categories.map((item) => [item.id, item]));
		const categoryParentMap = new Map(categoryParents.map((item) => [item.id, item]));

		// 格式化返回数据
		return {
			list: codes.map((code) => {
				const targetType = code.target_type || ActivationCodeTargetType.COURSE;
				const plan = targetType === ActivationCodeTargetType.PACKAGE && code.target_id ? packagePlanMap.get(code.target_id) : null;
				const category =
					targetType === ActivationCodeTargetType.CATEGORY_BUNDLE && code.target_id
						? categoryMap.get(code.target_id)
						: null;
				const categoryParent = category?.parent_id ? categoryParentMap.get(category.parent_id) : null;
				const targetName = plan
					? `${plan.section?.name || '套餐/VIP'} - ${plan.name}`
					: category
						? `${categoryParent ? `${categoryParent.name} / ` : ''}${category.name}`
						: this.getActivationRewardTargetName(code) || code.course?.name || '-';
				return {
					id: code.id,
					code: code.code,
					batch_id: code.batch_id,
					batch_prefix: code.batch_prefix || this.getBatchPrefix(code.batch_id),
					source_type: code.source_type,
					source_text: this.getSourceText(code),
					target_type: targetType,
					target_type_text: this.getActivationTargetTypeText(targetType),
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
						reward_payload?: ActivationCodeRewardPayload;
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
					reward_payload: target.rewardPayload,
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
				codes: codes.map((item) => item.code),
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
			reward_payload?: ActivationCodeRewardPayload;
		}) {
			const type = input.target_type || ActivationCodeTargetType.COURSE;
			if (type === ActivationCodeTargetType.AGENT) {
				const agentLevel = this.normalizeAgentLevel(input.reward_payload?.agent_level);
				return {
					type,
					id: null,
					courseId: null,
					name: `${this.getAgentLevelName(agentLevel)}身份`,
					rewardPayload: { agent_level: agentLevel },
				};
			}
			if (type === ActivationCodeTargetType.POINTS) {
				const amount = Number(input.reward_payload?.points_amount);
				if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
					throw new BadRequestException('请输入 1 至 1000000 的积分数量');
				}
				return {
					type,
					id: null,
					courseId: null,
					name: `${amount}积分`,
					rewardPayload: { points_amount: amount },
				};
			}
			if (type === ActivationCodeTargetType.COUPON) {
				const amount = Number(input.reward_payload?.coupon_amount);
				const minAmount = Number(input.reward_payload?.coupon_min_amount || 0);
				const rawValidDays = input.reward_payload?.coupon_valid_days;
				const validDays = rawValidDays === null || rawValidDays === undefined ? null : Number(rawValidDays);
				if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
					throw new BadRequestException('请输入有效的优惠券面额');
				}
				if (!Number.isFinite(minAmount) || minAmount < 0 || minAmount > 100000000) {
					throw new BadRequestException('请输入有效的使用门槛');
				}
				if (validDays !== null && (!Number.isInteger(validDays) || validDays < 1 || validDays > 3650)) {
					throw new BadRequestException('有效期需为 1 至 3650 天');
				}
				return {
					type,
					id: null,
					courseId: null,
					name: `${amount}元${minAmount > 0 ? `满${minAmount}元可用` : '无门槛'}优惠券`,
					rewardPayload: {
						coupon_amount: amount,
						coupon_min_amount: minAmount,
						coupon_valid_days: validDays,
					},
				};
			}
			if (type === ActivationCodeTargetType.CATEGORY_BUNDLE) {
				const categoryId = Number(input.target_id);
				if (!Number.isInteger(categoryId) || categoryId <= 0) {
					throw new BadRequestException('请选择类目套餐');
				}
				const category = await this.courseCategoryRepository.findOne({ where: { id: categoryId } });
				if (!category || category.status === 0 || Number(category.bundle_enabled ?? 1) !== 1) {
					throw new NotFoundException('类目套餐不存在或已关闭');
				}
				const parent = category.parent_id
					? await this.courseCategoryRepository.findOne({ where: { id: category.parent_id } })
					: null;
				if (category.parent_id && (!parent || parent.status === 0)) {
					throw new NotFoundException('类目套餐所属一级分类不存在或已关闭');
				}
				const courseCount = await this.courseRepository.count({
					where: parent
						? { category: parent.name, sub_category: category.name, status: 1 }
						: { category: category.name, status: 1 },
				});
				if (courseCount === 0) {
					throw new BadRequestException('该类目下暂无可激活资料');
				}
				return {
					type,
					id: category.id,
					courseId: null,
					name: `${parent ? `${parent.name} / ` : ''}${category.name}`,
					rewardPayload: null,
				};
			}
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
					rewardPayload: null,
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
				rewardPayload: null,
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
				if (
					code.target_type === ActivationCodeTargetType.POINTS ||
					code.target_type === ActivationCodeTargetType.COUPON ||
					code.target_type === ActivationCodeTargetType.AGENT
				) {
					throw new BadRequestException('积分、优惠券或代理商身份激活码使用后不可撤销');
				}

				code.status = ActivationCodeStatus.INVALID;
				await queryRunner.manager.save(ActivationCode, code);
				if (code.target_type === ActivationCodeTargetType.CATEGORY_BUNDLE) {
					await queryRunner.manager.delete(UserCategoryBundleAccess, { activation_code_id: code.id });
				} else {
					await this.revokeCodeCourseAuth(queryRunner.manager, code);
				}
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

		private getActivationTargetTypeText(type: ActivationCodeTargetType) {
			if (type === ActivationCodeTargetType.AGENT) return '代理商身份';
			if (type === ActivationCodeTargetType.PACKAGE) return '套餐/VIP';
			if (type === ActivationCodeTargetType.CATEGORY_BUNDLE) return '类目套餐';
			if (type === ActivationCodeTargetType.POINTS) return '积分';
			if (type === ActivationCodeTargetType.COUPON) return '优惠券';
			return '课程';
		}

		private getActivationRewardTargetName(code: ActivationCode) {
			if (code.target_type === ActivationCodeTargetType.AGENT) return '代理商身份';
			if (code.target_type === ActivationCodeTargetType.POINTS) {
				const amount = Number(code.reward_payload?.points_amount || 0);
				return amount > 0 ? `${amount}积分` : '积分';
			}
			if (code.target_type === ActivationCodeTargetType.COUPON) {
				const amount = Number(code.reward_payload?.coupon_amount || 0);
				const minAmount = Number(code.reward_payload?.coupon_min_amount || 0);
				if (amount <= 0) return '优惠券';
				return `${amount}元${minAmount > 0 ? `满${minAmount}元可用` : '无门槛'}优惠券`;
			}
			return '';
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

		private normalizeAgentLevel(value: unknown) {
			const level = Number(value);
			return Number.isInteger(level) && level >= 1 && level <= 3 ? level : 1;
		}

		private getAgentLevelName(value: unknown) {
			return ['一级代理', '二级代理', '三级代理'][this.normalizeAgentLevel(value) - 1];
		}

	}
