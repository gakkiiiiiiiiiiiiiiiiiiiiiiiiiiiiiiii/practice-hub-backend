import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ActivationCodeService } from './activation-code.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { RedeemCodeDto } from './dto/redeem-code.dto';

@ApiTags('激活码')
@Controller('app/code')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ActivationCodeController {
  constructor(private readonly activationCodeService: ActivationCodeService) {}

  @Post('redeem')
  @ApiOperation({ summary: '使用激活码' })
  async redeemCode(@CurrentUser() user: any, @Body() dto: RedeemCodeDto) {
    const result = await this.activationCodeService.redeemCode(user.userId, dto.code);
    return CommonResponseDto.success(result);
  }
}

