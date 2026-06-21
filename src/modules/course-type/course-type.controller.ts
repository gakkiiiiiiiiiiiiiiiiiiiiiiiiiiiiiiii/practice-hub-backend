import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CourseTypeService } from './course-type.service';

@ApiTags('课程类型')
@Controller()
export class CourseTypeController {
	constructor(private readonly courseTypeService: CourseTypeService) {}

	@Get('app/course-types')
	@ApiOperation({ summary: '小程序课程类型列表' })
	async getAppCourseTypes() {
		return CommonResponseDto.success(await this.courseTypeService.list({ onlyEnabled: true }));
	}

	@Get('admin/course-types')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiBearerAuth()
	@ApiOperation({ summary: '管理端课程类型列表' })
	async getAdminCourseTypes() {
		return CommonResponseDto.success(await this.courseTypeService.list());
	}

	@Post('admin/course-types')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiBearerAuth()
	@ApiOperation({ summary: '新增课程类型' })
	async createCourseType(@Body() body: any) {
		return CommonResponseDto.success(await this.courseTypeService.create(body));
	}

	@Put('admin/course-types/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiBearerAuth()
	@ApiOperation({ summary: '更新课程类型' })
	async updateCourseType(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
		return CommonResponseDto.success(await this.courseTypeService.update(id, body));
	}

	@Delete('admin/course-types/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
	@ApiBearerAuth()
	@ApiOperation({ summary: '删除课程类型' })
	async deleteCourseType(@Param('id', ParseIntPipe) id: number) {
		return CommonResponseDto.success(await this.courseTypeService.delete(id));
	}
}
