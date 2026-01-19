import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrajectoryService } from './trajectory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { GetTrajectoryDto } from './dto/get-trajectory.dto';

@ApiTags('学习轨迹')
@Controller('app/trajectory')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TrajectoryController {
	constructor(private readonly trajectoryService: TrajectoryService) {}

	@Get('list')
	@ApiOperation({ summary: '获取学习轨迹列表' })
	async getTrajectoryList(@CurrentUser() user: any, @Query() dto: GetTrajectoryDto) {
		const result = await this.trajectoryService.getTrajectoryList(user.userId, dto);
		return CommonResponseDto.success(result);
	}
}
