import { ForbiddenException } from '@nestjs/common';
import { AppUserRole } from '../../database/entities/app-user.entity';
import { AppCourseAdminController } from './admin-course.controller';

describe('AppCourseAdminController updateAgentPrice', () => {
	it('allows only an app super admin to update the agent price', async () => {
		const adminCourseService = {
			updateCourseAgentPrice: jest.fn().mockResolvedValue({ id: 12, agent_price: 8 }),
		};
		const appUserRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 607, role: AppUserRole.ADMIN }),
		};
		const controller = new AppCourseAdminController(adminCourseService as any, appUserRepository as any);

		await expect(controller.updateAgentPrice(12, { agent_price: 8 }, { userId: 607 })).resolves.toMatchObject({
			code: 200,
			data: { id: 12, agent_price: 8 },
		});
		expect(adminCourseService.updateCourseAgentPrice).toHaveBeenCalledWith(12, 8);
	});

	it('rejects a bank admin', async () => {
		const controller = new AppCourseAdminController(
			{ updateCourseAgentPrice: jest.fn() } as any,
			{ findOne: jest.fn().mockResolvedValue({ id: 608, role: AppUserRole.BANK_ADMIN }) } as any,
		);

		await expect(controller.updateAgentPrice(12, { agent_price: 8 }, { userId: 608 })).rejects.toBeInstanceOf(
			ForbiddenException,
		);
	});
});
