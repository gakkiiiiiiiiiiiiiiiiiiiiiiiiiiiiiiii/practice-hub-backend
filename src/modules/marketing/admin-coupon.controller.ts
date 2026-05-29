import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { ReferralCouponService } from './referral-coupon.service';
import { IssueCouponDto } from './dto/issue-coupon.dto';
import { GetAdminCouponListDto } from './dto/get-admin-coupon-list.dto';

@ApiTags('管理后台-优惠券')
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN)
export class AdminCouponController {
	constructor(private readonly referralCouponService: ReferralCouponService) {}

	@Get()
	@ApiOperation({ summary: '优惠券发放记录' })
	async getCouponList(@Query() dto: GetAdminCouponListDto) {
		const result = await this.referralCouponService.getAdminCouponList(dto);
		return CommonResponseDto.success(result);
	}

	@Post('issue')
	@ApiOperation({ summary: '给指定小程序用户发放优惠券' })
	async issueCoupon(@Body() dto: IssueCouponDto) {
		const result = await this.referralCouponService.issueCouponsByAdmin(dto);
		return CommonResponseDto.success(result);
	}
}
