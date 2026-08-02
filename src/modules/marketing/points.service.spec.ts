import { PointsService } from './points.service';

describe('PointsService', () => {
	it('keeps a stable item id for legacy config so it can be redeemed repeatedly', async () => {
		const systemConfigRepository = {
			findOne: jest.fn().mockResolvedValue({
				configKey: 'points_config',
				configValue: JSON.stringify({
					enabled: true,
					checkin_reward: 50,
					exchange_points: 500,
					exchange_coupon_amount: 5,
					exchange_coupon_min_amount: 0,
					coupon_valid_days: 365,
				}),
			}),
		};
		const service = new PointsService(
			systemConfigRepository as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
		);

		const firstConfig = await service.getConfig();
		const secondConfig = await service.getConfig();

		expect(firstConfig.exchange_items[0].id).toBe('legacy');
		expect(secondConfig.exchange_items[0].id).toBe('legacy');
		expect(service.resolveExchangeItem(secondConfig, firstConfig.exchange_items[0].id).id).toBe('legacy');
	});

	it('keeps deterministic fallback ids for persisted items that have no id', async () => {
		const systemConfigRepository = {
			findOne: jest.fn().mockResolvedValue({
				configKey: 'points_config',
				configValue: JSON.stringify({
					exchange_items: [
						{ points: 500, coupon_amount: 5, enabled: true },
						{ points: 900, coupon_amount: 10, enabled: true },
					],
				}),
			}),
		};
		const service = new PointsService(
			systemConfigRepository as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
		);

		const config = await service.getConfig();

		expect(config.exchange_items.map((item) => item.id)).toEqual(['legacy', 'legacy_2']);
	});
});
