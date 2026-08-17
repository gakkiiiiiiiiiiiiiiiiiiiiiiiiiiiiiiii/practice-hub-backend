import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SysErrorLog } from '../../database/entities/sys-error-log.entity';
import { ClientErrorService } from './client-error.service';

describe('ClientErrorService', () => {
	let service: ClientErrorService;
	let repository: { create: jest.Mock; save: jest.Mock };

	beforeEach(async () => {
		repository = {
			create: jest.fn((value) => value as SysErrorLog),
			save: jest.fn(async (value) => ({ ...value, id: 101 }) as SysErrorLog),
		};
		const module = await Test.createTestingModule({
			providers: [ClientErrorService, { provide: getRepositoryToken(SysErrorLog), useValue: repository }],
		}).compile();
		service = module.get(ClientErrorService);
	});

	it('saves a structured mini program error and removes sensitive fields', async () => {
		const result = await service.report(
			{
				eventType: 'virtual_payment_failed',
				message: 'requestVirtualPayment:fail',
				code: '-15007',
				page: 'pages/sub-pages/course-intro/index',
				context: { mode: 'short_series_coin', paySig: 'sensitive' },
				runtime: { brand: 'samsung', model: 'SM-S9280', platform: 'android' },
			},
			{ userId: 9, ip: '127.0.0.1' },
		);

		expect(result).toEqual({ accepted: true, id: 101 });
		expect(repository.create).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'CLIENT',
				code: -15007,
				userId: 9,
				errorName: 'MiniProgram:virtual_payment_failed',
				body: { mode: 'short_series_coin', paySig: '***' },
			}),
		);
	});

	it('deduplicates the same error for one tracker within a minute', async () => {
		const dto = { eventType: 'app_error', message: 'render failed' };
		await service.report(dto, { ip: '10.0.0.1' });
		const duplicate = await service.report(dto, { ip: '10.0.0.1' });

		expect(duplicate).toEqual({ accepted: true, deduplicated: true });
		expect(repository.save).toHaveBeenCalledTimes(1);
	});
});
