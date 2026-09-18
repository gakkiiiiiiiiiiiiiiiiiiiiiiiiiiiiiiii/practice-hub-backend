import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { AdminDistributorController } from './admin-distributor.controller';

describe('AdminDistributorController authorization', () => {
	it('requires a super-admin role for every distributor admin endpoint', () => {
		expect(Reflect.getMetadata(ROLES_KEY, AdminDistributorController)).toEqual([
			AdminRole.SUPER_ADMIN,
		]);
	});
});
