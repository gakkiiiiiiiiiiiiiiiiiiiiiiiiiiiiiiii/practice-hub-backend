import { ConfigService } from '@nestjs/config';
import { StorageProvider } from '../../common/constants/storage-provider';
import { StorageProviderService } from './storage-provider.service';
import { UploadService } from './upload.service';

describe('UploadService storage provider credentials', () => {
  const values: Record<string, string> = {
    OSS_BUCKET: 'example-bucket',
    OSS_REGION: 'oss-cn-shanghai',
    OSS_ACCESS_KEY_ID: 'test-access-key',
    OSS_ACCESS_KEY_SECRET: 'test-secret',
    OSS_LEGACY_COS_BUCKET: 'example-cos-bucket',
    OSS_LEGACY_COS_ENV_ID: 'example-env',
    COS_REGION: 'ap-shanghai',
    UPLOAD_DIR: '/tmp/practice-hub-upload-tests',
  };
  const configService = {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
  const storageProviderService = {
    getProvider: jest.fn(),
  } as unknown as jest.Mocked<StorageProviderService>;
  const service = new UploadService(configService, storageProviderService);

  beforeEach(() => {
    storageProviderService.getProvider.mockReset();
  });

  it('uses WeChat cloud upload credentials for Tencent COS', async () => {
    storageProviderService.getProvider.mockResolvedValue(StorageProvider.COS);

    const credentials = await service.getPostUploadCredentials('course-files/staging/test.pdf', 'application/pdf');

    expect(credentials).toMatchObject({
      method: 'WX_CLOUD',
      provider: StorageProvider.COS,
      cloudPath: 'course-files/staging/test.pdf',
      finalFileUrl: 'https://example-cos-bucket.tcb.qcloud.la/course-files/staging/test.pdf',
    });
  });

  it('uses signed form upload credentials for Alibaba OSS', async () => {
    storageProviderService.getProvider.mockResolvedValue(StorageProvider.OSS);

    const credentials = await service.getPostUploadCredentials('course-files/staging/test.pdf', 'application/pdf');

    expect(credentials).toMatchObject({
      method: 'POST',
      provider: StorageProvider.OSS,
      url: 'https://example-bucket.oss-cn-shanghai.aliyuncs.com',
      fields: {
        key: 'course-files/staging/test.pdf',
        OSSAccessKeyId: 'test-access-key',
        'Content-Type': 'application/pdf',
      },
    });
  });
});
