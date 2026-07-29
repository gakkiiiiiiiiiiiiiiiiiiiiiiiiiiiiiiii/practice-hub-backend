import { ServiceUnavailableException } from '@nestjs/common';
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
		delete process.env.WX_CLOUD_RUN_ENV;
	});

	afterEach(() => {
		delete process.env.WX_CLOUD_RUN_ENV;
		jest.restoreAllMocks();
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

	it('rewrites the OSS origin URL to the signed CDN domain', () => {
		const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		const pathname = '/course-files/example.pdf';
		const hash = createHash('md5')
			.update(`${pathname}-1700000000-0-0-testcdnprivatekey123`)
			.digest('hex');

		expect(
			service.getAuthorizedCourseFileUrl(
				`https://example-bucket.oss-cn-shanghai.aliyuncs.com${pathname}`,
			),
		).toBe(`https://cdn.example.com${pathname}?auth_key=1700000000-0-0-${hash}`);
		now.mockRestore();
	});

	it('routes preview sources to the COS worker whenever COS still has the object', async () => {
		const ossHead = jest.spyOn((service as any).oss, 'head').mockResolvedValue({});
		const cosHead = jest.spyOn((service as any).cos, 'headObject').mockResolvedValue({});

		await expect(
			service.resolvePreviewWorkerSource(
				'https://cdn.example.com/course-files/source.pdf',
			),
		).resolves.toBe('cos');
		expect(cosHead).toHaveBeenCalledWith({
			Bucket: 'example-cos-bucket',
			Region: 'ap-shanghai',
			Key: 'course-files/source.pdf',
		});
		expect(ossHead).not.toHaveBeenCalled();
	});

	it('routes a migrated legacy source to the OSS worker when OSS is preferred', async () => {
		const ossHead = jest.spyOn((service as any).oss, 'head').mockResolvedValue({});
		const cosHead = jest.spyOn((service as any).cos, 'headObject').mockResolvedValue({});

		await expect(
			service.resolvePreviewWorkerSource(
				'https://example-cos-bucket.tcb.qcloud.la/course-files/migrated.pdf',
				'oss',
			),
		).resolves.toBe('oss');
		expect(ossHead).toHaveBeenCalledWith('course-files/migrated.pdf');
		expect(cosHead).not.toHaveBeenCalled();
	});

	it('routes COS-missing preview sources to the OSS worker', async () => {
		const cosHead = jest
			.spyOn((service as any).cos, 'headObject')
			.mockRejectedValue(new Error('NoSuchKey'));
		const ossHead = jest.spyOn((service as any).oss, 'head').mockResolvedValue({});

		await expect(
			service.resolvePreviewWorkerSource(
				'https://cdn.example.com/course-files/migrated.pdf',
			),
		).resolves.toBe('oss');
		expect(cosHead).toHaveBeenCalledWith({
			Bucket: 'example-cos-bucket',
			Region: 'ap-shanghai',
			Key: 'course-files/migrated.pdf',
		});
		expect(ossHead).toHaveBeenCalledWith('course-files/migrated.pdf');
	});

	it('signs COS preview downloads with the Tencent internal domain', async () => {
		const getObjectUrl = jest
			.spyOn((service as any).cos, 'getObjectUrl')
			.mockImplementation((_options: any, callback: any) => {
				callback(null, {
					Url: 'https://example-cos-bucket.cos-internal.ap-shanghai.tencentcos.cn/course-files/legacy.pdf?q-sign=test',
				});
			});

		await expect(
			service.getPreviewWorkerDownloadUrl(
				'https://cdn.example.com/course-files/legacy.pdf',
				'cos',
			),
		).resolves.toContain('.cos-internal.ap-shanghai.tencentcos.cn/');
		expect(getObjectUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				Bucket: 'example-cos-bucket',
				Region: 'ap-shanghai',
				Key: 'course-files/legacy.pdf',
				Domain: '{Bucket}.cos-internal.{Region}.tencentcos.cn',
			}),
			expect.any(Function),
		);
	});

	it('signs COS preview downloads with the public domain for cross-cloud workers', async () => {
		const getObjectUrl = jest
			.spyOn((service as any).cos, 'getObjectUrl')
			.mockImplementation((_options: any, callback: any) => {
				callback(null, {
					Url: 'https://example-cos-bucket.cos.ap-shanghai.myqcloud.com/course-files/legacy.pdf?q-sign=test',
				});
			});

		await expect(
			service.getPreviewWorkerDownloadUrl(
				'https://cdn.example.com/course-files/legacy.pdf',
				'cos',
				true,
			),
		).resolves.toContain('.cos.ap-shanghai.myqcloud.com/');
		expect(getObjectUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				Domain: '{Bucket}.cos.{Region}.myqcloud.com',
			}),
			expect.any(Function),
		);
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

	it('blocks OSS course source body reads inside WeChat CloudBase', async () => {
		process.env.WX_CLOUD_RUN_ENV = 'true';
		const getObject = jest.spyOn((service as any).oss, 'get');
		const url = 'https://example-bucket.oss-cn-shanghai.aliyuncs.com/course-files/source.pdf';

		await expect(service.readObjectUrlBuffer(url)).rejects.toBeInstanceOf(ServiceUnavailableException);
		expect(getObject).not.toHaveBeenCalled();
	});

	it('blocks streaming OSS course sources to disk inside WeChat CloudBase', async () => {
		process.env.WX_CLOUD_RUN_ENV = 'true';
		const getStream = jest.spyOn((service as any).oss, 'getStream');
		const url = 'https://cdn.example.com/course-files/source.pdf';
		const destination = path.join(os.tmpdir(), 'blocked-course-source.pdf');

		await expect(service.downloadObjectUrlToFile(url, destination)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
		expect(getStream).not.toHaveBeenCalled();
	});

	it('deletes only objects under an approved preview cache prefix', async () => {
		const list = jest
			.spyOn((service as any).oss, 'list')
			.mockResolvedValueOnce({
				objects: [
					{ name: 'course-preview-cache/4/2/version/1.jpg' },
					{ name: 'course-preview-cache/4/2/version/2.jpg' },
				],
				isTruncated: false,
			});
		const deleteMulti = jest.spyOn((service as any).oss, 'deleteMulti').mockResolvedValue({});

		await expect(service.deletePreviewCachePrefix('course-preview-cache/4/2/version')).resolves.toBe(2);
		expect(list).toHaveBeenCalledWith({
			prefix: 'course-preview-cache/4/2/version/',
			marker: undefined,
			'max-keys': 1000,
		}, {});
		expect(deleteMulti).toHaveBeenCalledWith(
			[
				'course-preview-cache/4/2/version/1.jpg',
				'course-preview-cache/4/2/version/2.jpg',
			],
			{ quiet: true },
		);
	});
});
