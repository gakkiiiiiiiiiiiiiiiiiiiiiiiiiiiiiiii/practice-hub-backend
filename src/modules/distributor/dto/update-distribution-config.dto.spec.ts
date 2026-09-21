import { validate } from 'class-validator';
import { UpdateDistributionConfigDto } from './update-distribution-config.dto';

describe('UpdateDistributionConfigDto', () => {
	it('rejects malformed or out-of-range commission rate arrays', async () => {
		const dto = Object.assign(new UpdateDistributionConfigDto(), {
			base_commission_rates: [-10, 250],
			direct_commission_rates: [5],
			indirect_commission_rates: [],
		});

		expect(await validate(dto)).toHaveLength(3);
	});

	it('accepts exactly three rates between zero and one hundred', async () => {
		const dto = Object.assign(new UpdateDistributionConfigDto(), {
			base_commission_rates: [0, 25, 100],
			direct_commission_rates: [5, 6, 8],
			indirect_commission_rates: [0, 3, 4],
			promotion_poster_url: 'https://cdn.example.com/distributor-poster.jpg',
			is_enabled: 0,
		});

		expect(await validate(dto)).toEqual([]);
	});

	it('rejects a non-http promotion poster value', async () => {
		const dto = Object.assign(new UpdateDistributionConfigDto(), {
			promotion_poster_url: '/local/poster.jpg',
		});

		expect(await validate(dto)).toHaveLength(1);
	});

	it('accepts an empty poster value to restore the built-in poster', async () => {
		const dto = Object.assign(new UpdateDistributionConfigDto(), {
			promotion_poster_url: '',
		});

		expect(await validate(dto)).toEqual([]);
	});
});
