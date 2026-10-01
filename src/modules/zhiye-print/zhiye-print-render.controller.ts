import { Body, Controller, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZhiyePrintService } from './zhiye-print.service';
import { renderQuestionsToPdf } from './zhiye-print-renderer';
import { ZhiyeAppGuard } from './zhiye-app.guard';

@Controller('app/zhiye-print')
@UseGuards(JwtAuthGuard, ZhiyeAppGuard)
export class ZhiyePrintRenderController {
  constructor(private readonly service: ZhiyePrintService) {}

  @Post('render')
  async render(@CurrentUser() user: any, @Body() body: any) {
    if (user.type !== 'app' || !Number.isInteger(Number(user.userId))) throw new UnauthorizedException('请先登录小程序');
    const pdf = await renderQuestionsToPdf(body);
    return CommonResponseDto.success(await this.service.createDraftFromPdfBuffer(Number(user.userId), pdf, '知页练习纸.pdf', body.title || '知页练习纸'));
  }
}
