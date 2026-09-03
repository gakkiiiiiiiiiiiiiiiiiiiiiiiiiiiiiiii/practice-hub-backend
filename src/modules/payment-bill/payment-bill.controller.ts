import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { Request, Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { AdminRole } from "../../database/entities/sys-user.entity";
import { CommonResponseDto } from "../../common/dto/common-response.dto";
import {
  BillDownloadDto,
  BillListDto,
  BillPageDto,
  FetchBillDto,
} from "./payment-bill.dto";
import { PaymentBillService } from "./payment-bill.service";

@Injectable()
export class BillAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest().user;
    if (
      user?.type !== "admin" ||
      !Number.isSafeInteger(Number(user.adminId)) ||
      Number(user.adminId) <= 0
    ) {
      throw new ForbiddenException("仅管理系统超级管理员可访问支付账单");
    }
    return true;
  }
}

@Controller("admin/payment-bills")
@UseGuards(JwtAuthGuard, RolesGuard, BillAdminGuard)
@Roles(AdminRole.SUPER_ADMIN)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class PaymentBillController {
  constructor(private readonly service: PaymentBillService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async list(@Query() query: BillListDto) {
    return CommonResponseDto.success(await this.service.list(query));
  }

  @Post("fetch")
  @Header("Cache-Control", "no-store")
  async fetch(@Body() body: FetchBillDto) {
    return CommonResponseDto.success(await this.service.fetch(body));
  }

  @Get(":id/preview")
  @Header("Cache-Control", "no-store")
  async preview(
    @Param("id", ParseIntPipe) id: number,
    @Query() query: BillPageDto,
    @Req() request: Request,
  ) {
    const result = await this.service.preview(id, query);
    await this.service.audit(
      Number((request.user as any).adminId),
      "preview",
      id,
    );
    return CommonResponseDto.success(result);
  }

  @Get(":id/download")
  async download(
    @Param("id", ParseIntPipe) id: number,
    @Query() query: BillDownloadDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.service.download(id, query.format);
    await this.service.audit(
      Number((request.user as any).adminId),
      "download",
      id,
      query.format,
    );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", result.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    response.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    response.send(result.buffer);
  }
}
