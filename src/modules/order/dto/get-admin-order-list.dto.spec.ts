import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetAdminOrderListDto } from './get-admin-order-list.dto';

describe('GetAdminOrderListDto', () => {
	it('accepts the 100-row page size used by the admin table', async () => {
		const dto = plainToInstance(GetAdminOrderListDto, {
			page: '1',
			pageSize: '100',
		});

		await expect(validate(dto)).resolves.toEqual([]);
		expect(dto.pageSize).toBe(100);
	});

	it('rejects page sizes above 100', async () => {
		const dto = plainToInstance(GetAdminOrderListDto, {
			page: '1',
			pageSize: '101',
		});

		const errors = await validate(dto);
		expect(errors.some((error) => error.property === 'pageSize')).toBe(true);
	});

	it('accepts paper order and cloud print status filters', async () => {
		const dto = plainToInstance(GetAdminOrderListDto, {
			paper_only: 'true',
			cloud_print_status: 'retryable_failed',
		});

		await expect(validate(dto)).resolves.toEqual([]);
		expect(dto.paper_only).toBe(true);
		expect(dto.cloud_print_status).toBe('retryable_failed');
	});

	it('rejects an unknown cloud print status', async () => {
		const dto = plainToInstance(GetAdminOrderListDto, {
			cloud_print_status: 'unknown',
		});

		const errors = await validate(dto);
		expect(errors.some((error) => error.property === 'cloud_print_status')).toBe(true);
	});
});
