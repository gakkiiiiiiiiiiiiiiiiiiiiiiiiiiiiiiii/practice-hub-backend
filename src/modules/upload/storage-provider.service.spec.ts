import { StorageProvider } from '../../common/constants/storage-provider';
import { StorageProviderService } from './storage-provider.service';

describe('StorageProviderService', () => {
  const repository = {
    findOne: jest.fn(),
  };
  const service = new StorageProviderService(repository as any);

  beforeEach(() => {
    repository.findOne.mockReset();
  });

  it('defaults to Tencent COS when no setting exists', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.getProvider()).resolves.toBe(StorageProvider.COS);
  });

  it('returns the configured provider', async () => {
    repository.findOne.mockResolvedValue({ configValue: JSON.stringify(StorageProvider.OSS) });

    await expect(service.getProvider()).resolves.toBe(StorageProvider.OSS);
  });

  it('falls back to Tencent COS for an invalid value', async () => {
    repository.findOne.mockResolvedValue({ configValue: '"unknown"' });

    await expect(service.getProvider()).resolves.toBe(StorageProvider.COS);
  });
});
