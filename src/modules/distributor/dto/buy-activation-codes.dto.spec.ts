import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BuyActivationCodesDto } from './buy-activation-codes.dto';

const validatePayload = (payload: Record<string, unknown>) =>
	validate(plainToInstance(BuyActivationCodesDto, payload), {
		whitelist: true,
		forbidNonWhitelisted: true,
	});

describe('BuyActivationCodesDto', () => {
	it('accepts the legacy mini-program course target fields', async () => {
		const errors = await validatePayload({
			course_id: 2601,
			count: 1,
			target_type: 'course',
			target_id: 2601,
		});

		expect(errors).toHaveLength(0);
	});

	it('rejects unsupported target types', async () => {
		const errors = await validatePayload({
			course_id: 2601,
			count: 1,
			target_type: 'package',
			target_id: 2601,
		});

		expect(errors.some((error) => error.property === 'target_type')).toBe(true);
	});

	it('continues to reject unknown fields', async () => {
		const errors = await validatePayload({ course_id: 2601, count: 1, unexpected: true });

		expect(errors.some((error) => error.property === 'unexpected')).toBe(true);
	});
});
