import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ClientErrorService } from './client-error.service';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

@ApiTags('小程序错误上报')
@Controller('app/client-errors')
export class ClientErrorController {
	constructor(private readonly clientErrorService: ClientErrorService) {}

	@Post()
	@UseGuards(OptionalJwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '上报小程序客户端错误' })
	async report(@Body() dto: ReportClientErrorDto, @CurrentUser() user: any, @Req() request: Request) {
		const forwardedFor = request.headers['x-forwarded-for'];
		const ip = Array.isArray(forwardedFor)
			? forwardedFor[0]
			: String(forwardedFor || request.ip || request.socket?.remoteAddress || '');
		const result = await this.clientErrorService.report(dto, {
			ip,
			requestId: String(request.headers['x-request-id'] || ''),
			userAgent: String(request.headers['user-agent'] || ''),
			userId: user?.userId || user?.id,
		});
		return CommonResponseDto.success(result);
	}
}
