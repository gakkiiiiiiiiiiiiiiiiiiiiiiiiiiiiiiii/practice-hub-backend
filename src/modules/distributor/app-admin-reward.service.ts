import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { UserPointsLog, UserPointsLogType } from '../../database/entities/user-points-log.entity';
import { IssueCouponDto } from '../marketing/dto/issue-coupon.dto';
import { ReferralCouponService } from '../marketing/referral-coupon.service';
import { GrantAppUserPointsDto } from './dto/grant-app-user-points.dto';

@Injectable()
export class AppAdminRewardService {
	constructor(
		@InjectRepository(AppUser)
		private readonly appUserRepository: Repository<AppUser>,
		private readonly dataSource: DataSource,
		private readonly referralCouponService: ReferralCouponService,
	) {}

	async getTargetUser(requesterUserId: number, targetUserId: number) {
		await this.assertAppAdmin(requesterUserId);
		const normalizedTargetUserId = this.normalizeTargetUserId(targetUserId);
		const user = await this.appUserRepository.findOne({ where: { id: normalizedTargetUserId } });
		if (!user) {
			throw new NotFoundException('目标用户不存在');
		}
		return this.buildUserSummary(user);
	}

	async grantPoints(requesterUserId: number, targetUserId: number, dto: GrantAppUserPointsDto) {
		await this.assertAppAdmin(requesterUserId);
		const normalizedTargetUserId = this.normalizeTargetUserId(targetUserId);

		return this.dataSource.transaction(async (manager) => {
			const user = await manager.findOne(AppUser, {
				where: { id: normalizedTargetUserId },
				lock: { mode: 'pessimistic_write' },
			});
			if (!user) {
				throw new NotFoundException('目标用户不存在');
			}

			const amount = Number(dto.amount);
			user.points_balance = Number(user.points_balance || 0) + amount;
			await manager.save(AppUser, user);
			await manager.save(
				UserPointsLog,
				manager.create(UserPointsLog, {
					userId: user.id,
					changeAmount: amount,
					balanceAfter: user.points_balance,
					type: UserPointsLogType.ADJUST,
					remark: dto.remark?.trim() || `小程序超管 ${requesterUserId} 赠送积分`,
				}),
			);

			return {
				...this.buildUserSummary(user),
				grantedAmount: amount,
			};
		});
	}

	async issueCoupons(requesterUserId: number, dto: IssueCouponDto) {
		await this.assertAppAdmin(requesterUserId);
		return this.referralCouponService.issueCouponsByAdmin(dto);
	}

	private normalizeTargetUserId(userId: number) {
		const normalized = Number(userId);
		if (!Number.isInteger(normalized) || normalized < 1) {
			throw new BadRequestException('请输入正确的用户 ID');
		}
		return normalized;
	}

	private async assertAppAdmin(userId: number) {
		const user = await this.appUserRepository.findOne({ where: { id: userId } });
		if (!user || user.role !== AppUserRole.ADMIN) {
			throw new ForbiddenException('仅小程序超级管理员可以发放奖励');
		}
	}

	private buildUserSummary(user: AppUser) {
		const phone = String(user.phone || '');
		const maskedPhone =
			phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone || '';
		return {
			id: user.id,
			nickname: user.nickname || '未设置',
			avatar: user.avatar || '',
			phone: maskedPhone,
			pointsBalance: Math.max(0, Number(user.points_balance || 0)),
		};
	}
}
