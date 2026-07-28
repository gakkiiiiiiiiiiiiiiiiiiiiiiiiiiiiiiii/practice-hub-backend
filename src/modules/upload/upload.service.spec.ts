import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { StorageProvider } from '../../common/constants/storage-provider';
import { StorageProviderService } from './storage-provider.service';
import { UploadService } from './upload.service';

describe('UploadService storage provider credentials', () => {
	const values: Record<string, string> = {
		OSS_BUCKET: 'example-bucket',
		OSS_REGION: 'oss-cn-shanghai',
		OSS_ACCESS_KEY_ID: 'test-access-key',
		OSS_ACCESS_KEY_SECRET: 'test-secret',
		OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
		OSS_LEGACY_COS_BUCKET: 'example-cos-bucket',
		OSS_LEGACY_COS_ENV_ID: 'example-env',
		CDN_AUTH_ENABLED: 'true',
		CDN_AUTH_KEY: 'testcdnprivatekey123',
		COS_BUCKET: 'example-cos-bucket',
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

	it('converts a WeChat cloud file ID to its TCB HTTPS URL', () => {
		const fileId = 'cloud://example-env.example-cos-bucket/feedback/example.jpg';

		expect(service.getPublicImageUrl(fileId)).toBe('https://example-cos-bucket.tcb.qcloud.la/feedback/example.jpg');
	});

	it('does not rewrite a cloud file ID from another bucket', () => {
		const fileId = 'cloud://another-env.another-bucket/feedback/example.jpg';

		expect(service.getPublicImageUrl(fileId)).toBe(fileId);
	});

	it('signs only course files on the configured CDN domain', () => {
		const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		const pathname = '/course-files/example.pdf';
		const hash = createHash('md5')
			.update(`${pathname}-1700000000-0-0-testcdnprivatekey123`)
			.digest('hex');

		expect(service.getAuthorizedCourseFileUrl(`https://cdn.example.com${pathname}`)).toBe(
			`https://cdn.example.com${pathname}?auth_key=1700000000-0-0-${hash}`,
		);
		expect(service.getAuthorizedCourseFileUrl('https://cdn.example.com/images/cover.jpg')).toBe(
			'https://cdn.example.com/images/cover.jpg',
		);
		expect(service.getAuthorizedCourseFileUrl('https://other.example.com/course-files/example.pdf')).toBe(
			'https://other.example.com/course-files/example.pdf',
		);
		now.mockRestore();
	});

	it('signs generated preview cache URLs on the CDN domain', () => {
		const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		const key = 'course-preview-cache/4/2/full-version/19.jpg';
		const pathname = `/${key}`;
		const hash = createHash('md5')
			.update(`${pathname}-1700000000-0-0-testcdnprivatekey123`)
			.digest('hex');

		expect(service.getAuthorizedPreviewCacheUrl(key)).toBe(
			`https://cdn.example.com${pathname}?auth_key=1700000000-0-0-${hash}`,
		);
		now.mockRestore();
	});

	it('reads an OSS URL from OSS even when the active upload provider is COS', async () => {
		storageProviderService.getProvider.mockResolvedValue(StorageProvider.COS);
		const getObject = jest
			.spyOn((service as any).oss, 'get')
			.mockResolvedValue({ content: Buffer.from('%PDF-test') });

		const result = await service.readObjectUrlBuffer(
			'https://example-bucket.oss-cn-shanghai.aliyuncs.com/course-files/repaired/file.pdf',
		);

		expect(result).toEqual(Buffer.from('%PDF-test'));
		expect(getObject).toHaveBeenCalledWith('course-files/repaired/file.pdf');
		expect(storageProviderService.getProvider).not.toHaveBeenCalled();
	});

	it('streams a large OSS course file to disk without consulting the active provider', async () => {
		storageProviderService.getProvider.mockResolvedValue(StorageProvider.COS);
		const payload = Buffer.from('%PDF-streamed');
		jest
			.spyOn((service as any).oss, 'getStream')
			.mockResolvedValue({ stream: Readable.from(payload) });
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-service-stream-'));
		const destination = path.join(tmpDir, 'source.pdf');

		try {
			const size = await service.downloadObjectUrlToFile(
				'https://example-bucket.oss-cn-shanghai.aliyuncs.com/course-files/source.pdf',
				destination,
			);

			expect(size).toBe(payload.length);
			expect(fs.readFileSync(destination)).toEqual(payload);
			expect(storageProviderService.getProvider).not.toHaveBeenCalled();
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('falls back to Tencent COS when reading an OSS URL fails', async () => {
		const payload = Buffer.from('%PDF-from-cos');
		jest.spyOn(service as any, 'readOssObjectBuffer').mockResolvedValue(null);
		const readCosObjectBuffer = jest.spyOn(service as any, 'readCosObjectBuffer').mockResolvedValue(payload);

		const result = await service.readObjectUrlBuffer(
			'https://cdn.example.com/course-files/source.pdf',
		);

		expect(result).toEqual(payload);
		expect(readCosObjectBuffer).toHaveBeenCalledWith('course-files/source.pdf');
	});

	it('falls back to Tencent COS when streaming an OSS course file fails', async () => {
		const payload = Buffer.from('%PDF-streamed-from-cos');
		jest.spyOn((service as any).oss, 'getStream').mockRejectedValue({
			code: 'UserDisable',
			status: 403,
		});
		const downloadCosObjectToFile = jest
			.spyOn(service as any, 'downloadCosObjectToFile')
			.mockImplementation(async (_key: string, destination: string) => {
				await fs.promises.writeFile(destination, payload);
			});
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-service-fallback-'));
		const destination = path.join(tmpDir, 'source.pdf');

		try {
			const size = await service.downloadObjectUrlToFile(
				'https://cdn.example.com/course-files/source.pdf',
				destination,
			);

			expect(size).toBe(payload.length);
			expect(fs.readFileSync(destination)).toEqual(payload);
			expect(downloadCosObjectToFile).toHaveBeenCalledWith('course-files/source.pdf', destination);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
