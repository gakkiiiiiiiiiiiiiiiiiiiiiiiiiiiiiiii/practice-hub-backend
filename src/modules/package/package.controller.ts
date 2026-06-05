import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { PackageService } from './package.service';

@ApiTags('套餐')
@Controller('app/package')
export class PackageController {
	constructor(private readonly packageService: PackageService) {}

	@Get('sections')
	@UseGuards(OptionalJwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '套餐列表' })
	async getSections(@CurrentUser() user?: any) {
		const result = await this.packageService.getAppSectionList(user?.userId);
		return CommonResponseDto.success(result);
	}

	@Get('sections/:id')
	@UseGuards(OptionalJwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '套餐详情' })
	async getSectionDetail(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
		const result = await this.packageService.getAppSectionDetail(id, user?.userId);
		return CommonResponseDto.success(result);
	}

	@Get('subscriptions')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '我的套餐订阅' })
	async getSubscriptions(@CurrentUser() user: any) {
		const result = await this.packageService.getUserActiveSubscriptions(user.userId);
		return CommonResponseDto.success(result);
	}
}
