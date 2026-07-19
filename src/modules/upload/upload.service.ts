import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS = require('ali-oss');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHmac } from 'crypto';
import axios from 'axios';

@Injectable()
export class UploadService {
	private readonly logger = new Logger(UploadService.name);
	private oss: OSS | null = null;
	private bucket: string;
	private region: string;
	private endpoint: string;
	private originBaseUrl: string;
	private publicBaseUrl: string;
	private legacyCosBucket: string;
	private legacyCosEnvId: string;
	private uploadDir: string;
	private baseUrl: string;

	constructor(private configService: ConfigService) {
		this.bucket = this.configService.get<string>('OSS_BUCKET', '');
		this.region = this.configService.get<string>('OSS_REGION', 'oss-cn-shanghai');
		this.endpoint = this.configService.get<string>('OSS_ENDPOINT', '');
		this.legacyCosBucket = this.configService.get<string>(
			'OSS_LEGACY_COS_BUCKET',
			'7072-prod-d1gguk4ie589126ba-1424780330',
		);
		this.legacyCosEnvId = this.configService.get<string>('OSS_LEGACY_COS_ENV_ID', 'prod-d1gguk4ie589126ba');
		const endpointHost = this.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
		this.originBaseUrl = endpointHost
			? `https://${this.bucket}.${endpointHost}`
			: `https://${this.bucket}.${this.region}.aliyuncs.com`;
		this.publicBaseUrl = (this.configService.get<string>('OSS_PUBLIC_BASE_URL') || this.originBaseUrl).replace(
			/\/$/,
			'',
		);

		// 本地存储配置（可通过 UPLOAD_DIR 覆盖；容器内默认 uploads）
		this.uploadDir = this.configService.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads');

		// 获取基础 URL，优先使用环境变量，否则根据端口自动判断
		const port = parseInt(process.env.PORT || '8080', 10);
		this.baseUrl = this.configService.get<string>('BASE_URL') || `http://localhost:${port}`;

		// 确保上传目录存在
		this.ensureUploadDir();

		const accessKeyId = this.configService.get<string>('OSS_ACCESS_KEY_ID');
		const accessKeySecret = this.configService.get<string>('OSS_ACCESS_KEY_SECRET');
		if (this.bucket && accessKeyId && accessKeySecret) {
			this.oss = new OSS({
				region: this.region,
				bucket: this.bucket,
				accessKeyId,
				accessKeySecret,
				...(this.endpoint ? { endpoint: this.endpoint } : {}),
				secure: true,
				timeout: 10 * 60 * 1000,
			});
			this.logger.log(`阿里云 OSS 已启用: bucket=${this.bucket}, region=${this.region}`);
		} else {
			this.logger.warn('OSS 配置不完整，上传文件将保存到本地');
		}
	}

	/**
	 * 确保上传目录存在
	 */
	private ensureUploadDir(): void {
		try {
			if (!fs.existsSync(this.uploadDir)) {
				fs.mkdirSync(this.uploadDir, { recursive: true });
				console.log(`[本地存储] 创建上传目录: ${this.uploadDir}`);
			}
		} catch (error: any) {
			const fallbackDir = path.join(os.tmpdir(), 'practice-hub-uploads');
			this.logger.warn(`无法创建上传目录 ${this.uploadDir}（${error?.message || error}），改用 ${fallbackDir}`);
			this.uploadDir = fallbackDir;
			if (!fs.existsSync(this.uploadDir)) {
				fs.mkdirSync(this.uploadDir, { recursive: true });
			}
		}
	}

	private isObjectStorageEnabled(): boolean {
		return this.oss !== null;
	}

	private requireOss(): OSS {
		if (!this.oss) {
			throw new BadRequestException('阿里云 OSS 配置不完整');
		}
		return this.oss;
	}

	/**
	 * 验证文件名安全性（防止路径遍历攻击）
	 * @param filename 文件名
	 * @returns 是否安全
	 */
	private isValidFilename(filename: string): boolean {
		// 检查是否包含路径遍历字符
		if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
			return false;
		}
		// 检查文件名长度
		if (filename.length > 255) {
			return false;
		}
		// 检查是否包含控制字符
		if (/[\x00-\x1F\x7F]/.test(filename)) {
			return false;
		}
		return true;
	}

	private isValidFolder(folder: string): boolean {
		const parts = String(folder || '')
			.split('/')
			.filter(Boolean);
		return parts.length > 0 && parts.every((part) => this.isValidFilename(part));
	}

	/**
	 * 清理文件名（移除不安全字符）
	 * @param filename 原始文件名
	 * @returns 清理后的文件名
	 */
	private sanitizeFilename(filename: string): string {
		// 移除路径分隔符和危险字符
		return filename
			.replace(/[\/\\]/g, '')
			.replace(/\.\./g, '')
			.replace(/[\x00-\x1F\x7F]/g, '')
			.substring(0, 255);
	}

	/**
	 * 保存文件到本地
	 * @param file 文件对象
	 * @param folder 存储文件夹
	 * @returns 文件相对路径
	 */
	private async saveFileToLocal(file: Express.Multer.File, folder: string = 'images'): Promise<string> {
		// 验证原始文件名
		if (!this.isValidFilename(file.originalname)) {
			throw new BadRequestException('文件名包含不安全字符');
		}

		// 验证文件夹名称
		if (!this.isValidFilename(folder)) {
			throw new BadRequestException('文件夹名称包含不安全字符');
		}

		// 生成唯一文件名（使用时间戳和随机字符串，不依赖原始文件名）
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const ext = this.getFileExtension(file.originalname);

		// 验证扩展名
		const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
		const normalizedExt = ext.toLowerCase();
		if (!allowedExts.includes(normalizedExt)) {
			throw new BadRequestException('不支持的文件扩展名');
		}

		const fileName = `${timestamp}-${randomStr}${normalizedExt}`;

		// 创建文件夹目录（使用 path.join 防止路径遍历）
		const folderPath = path.join(this.uploadDir, folder);
		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath, { recursive: true });
		}

		// 保存文件（使用 path.join 确保路径安全）
		const filePath = path.join(folderPath, fileName);

		// 双重验证：确保文件路径在 uploadDir 内
		const resolvedPath = path.resolve(filePath);
		const resolvedUploadDir = path.resolve(this.uploadDir);
		if (!resolvedPath.startsWith(resolvedUploadDir)) {
			throw new BadRequestException('文件路径不安全');
		}

		fs.writeFileSync(filePath, file.buffer);

		console.log(`[本地存储] 文件保存成功: ${filePath}`);

		// 返回相对路径，用于构建 URL
		return `${folder}/${fileName}`;
	}

	/**
	 * 上传图片（根据环境选择存储方式）
	 * @param file 文件对象
	 * @param folder 存储文件夹（可选，默认为 images）
	 * @returns 图片 URL
	 */
	async uploadImage(file: Express.Multer.File, folder: string = 'images', openid: string = ''): Promise<string> {
		if (!file) {
			throw new BadRequestException('文件不能为空');
		}

		// 验证文件类型
		const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
		if (!allowedMimeTypes.includes(file.mimetype)) {
			throw new BadRequestException('不支持的文件类型，仅支持 jpg、png、gif、webp');
		}

		// 根据环境选择存储方式
		if (this.isObjectStorageEnabled()) {
			return this.uploadToOss(file, folder);
		} else {
			return this.uploadToLocal(file, folder);
		}
	}

	/**
	 * 上传图片到本地
	 * @param file 文件对象
	 * @param folder 存储文件夹
	 * @returns 图片 URL
	 */
	private async uploadToLocal(file: Express.Multer.File, folder: string = 'images'): Promise<string> {
		try {
			const relativePath = await this.saveFileToLocal(file, folder);
			const imageUrl = `${this.baseUrl}/uploads/${relativePath}`;
			console.log(`[本地存储] 上传成功: ${imageUrl}`);
			return imageUrl;
		} catch (error: any) {
			console.error('[本地存储] 上传失败:', error);
			throw new BadRequestException(`图片上传失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 上传图片到阿里云 OSS
	 * @param file 文件对象
	 * @param folder 存储文件夹（可选，默认为 images）
	 * @param openid 用户openid（可选，管理端上传时可不传）
	 * @returns 图片 URL
	 */
	private async uploadToOss(file: Express.Multer.File, folder: string = 'images'): Promise<string> {
		// 验证文件名和文件夹名
		if (!this.isValidFilename(file.originalname)) {
			throw new BadRequestException('文件名包含不安全字符');
		}
		if (!this.isValidFilename(folder)) {
			throw new BadRequestException('文件夹名称包含不安全字符');
		}

		// 生成唯一文件名（使用时间戳和随机字符串，不依赖原始文件名）
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const ext = this.getFileExtension(file.originalname);

		// 验证扩展名
		const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
		const normalizedExt = ext.toLowerCase();
		if (!allowedExts.includes(normalizedExt)) {
			throw new BadRequestException('不支持的文件扩展名');
		}

		const fileName = `${folder}/${timestamp}-${randomStr}${normalizedExt}`;
		try {
			await this.requireOss().put(fileName, file.buffer, {
				headers: {
					'Content-Type': file.mimetype,
				},
			});
			const imageUrl = this.getObjectUrl(fileName);
			console.log(`[OSS上传] 图片成功: ${imageUrl}`);
			return imageUrl;
		} catch (error: any) {
			console.error('[OSS上传] 失败:', error);
			throw new BadRequestException(`图片上传失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 根据 URL 删除文件（本地或 OSS），供图片、PDF 等统一使用
	 * @param fileUrl 文件 URL
	 */
	async deleteByUrlOrThrow(fileUrl: string, allowedPrefixes?: string[]): Promise<void> {
		if (!fileUrl || typeof fileUrl !== 'string') return;
		const normalizedPrefixes = (allowedPrefixes || []).map((prefix) => this.normalizeObjectKey(prefix));
		const assertAllowedKey = (key: string) => {
			if (normalizedPrefixes.length && !normalizedPrefixes.some((prefix) => key.startsWith(prefix))) {
				throw new BadRequestException('拒绝删除不属于允许目录的文件');
			}
		};

		if (fileUrl.includes('/uploads/')) {
			const relativePath = decodeURIComponent(fileUrl.split('/uploads/')[1].split(/[?#]/, 1)[0]).replace(/^\/+/, '');
			assertAllowedKey(relativePath);
			const filePath = path.resolve(this.uploadDir, relativePath);
			const resolvedUploadDir = path.resolve(this.uploadDir);
			if (!filePath.startsWith(`${resolvedUploadDir}${path.sep}`)) {
				throw new BadRequestException('本地文件路径不安全');
			}
			if (fs.existsSync(filePath)) {
				await fs.promises.unlink(filePath);
				this.logger.log(`[本地存储] 删除成功: ${relativePath}`);
			}
			return;
		}

		const key = this.extractKeyFromUrl(fileUrl);
		if (!key) {
			throw new BadRequestException('无效或非本项目的文件 URL');
		}
		assertAllowedKey(key);
		await this.requireOss().delete(key);
		this.logger.log(`[OSS删除] 成功: ${key}`);
	}

	async deleteByUrl(fileUrl: string): Promise<void> {
		try {
			await this.deleteByUrlOrThrow(fileUrl);
		} catch (error: any) {
			this.logger.error(`[删除文件] 失败: ${error?.message || error}`);
		}
	}

	async promoteCourseFileUrl(fileUrl: string): Promise<{ url: string; promoted: boolean }> {
		const stagingPrefix = 'course-files/staging/';
		const permanentPrefix = 'course-files/';
		if (fileUrl.includes('/uploads/')) {
			const relativePath = decodeURIComponent(fileUrl.split('/uploads/')[1].split(/[?#]/, 1)[0]).replace(/^\/+/, '');
			if (!relativePath.startsWith(stagingPrefix)) return { url: fileUrl, promoted: false };
			const nextRelativePath = `${permanentPrefix}${relativePath.slice(stagingPrefix.length)}`;
			const sourcePath = path.resolve(this.uploadDir, relativePath);
			const destinationPath = path.resolve(this.uploadDir, nextRelativePath);
			const resolvedUploadDir = path.resolve(this.uploadDir);
			if (
				!sourcePath.startsWith(`${resolvedUploadDir}${path.sep}`) ||
				!destinationPath.startsWith(`${resolvedUploadDir}${path.sep}`)
			) {
				throw new BadRequestException('课程文件路径不安全');
			}
			if (!fs.existsSync(sourcePath)) throw new BadRequestException('待绑定的课程文件不存在');
			await fs.promises.mkdir(path.dirname(destinationPath), {
				recursive: true,
			});
			await fs.promises.rename(sourcePath, destinationPath);
			return {
				url: `${this.baseUrl}/uploads/${nextRelativePath}`,
				promoted: true,
			};
		}

		const sourceKey = this.extractKeyFromUrl(fileUrl);
		if (!sourceKey || !sourceKey.startsWith(stagingPrefix)) return { url: fileUrl, promoted: false };
		const destinationKey = `${permanentPrefix}${sourceKey.slice(stagingPrefix.length)}`;
		await this.requireOss().copy(destinationKey, sourceKey);
		try {
			await this.requireOss().delete(sourceKey);
		} catch (error: any) {
			this.logger.warn(
				`课程文件提升成功，但临时对象删除失败，将由生命周期清理: ${sourceKey}; ${error?.message || error}`,
			);
		}
		return { url: this.getObjectUrl(destinationKey), promoted: true };
	}

	async deleteCoursePreviewPrefix(prefix: string): Promise<number> {
		const safePrefix = this.normalizeObjectKey(prefix);
		if (!safePrefix.startsWith('course-preview-cache/')) {
			throw new BadRequestException('拒绝删除不属于课程预览缓存的目录');
		}
		if (!this.isObjectStorageEnabled()) {
			const targetPath = path.resolve(this.uploadDir, safePrefix);
			const resolvedUploadDir = path.resolve(this.uploadDir);
			if (!targetPath.startsWith(`${resolvedUploadDir}${path.sep}`)) {
				throw new BadRequestException('预览缓存路径不安全');
			}
			if (!fs.existsSync(targetPath)) return 0;
			await fs.promises.rm(targetPath, { recursive: true, force: true });
			return 1;
		}

		let marker: string | undefined;
		let deletedCount = 0;
		do {
			const result: any = await this.requireOss().list({ prefix: safePrefix, marker, 'max-keys': 1000 }, {});
			const keys = (result.objects || []).map((object: any) => object.name).filter(Boolean);
			if (keys.length) {
				await this.requireOss().deleteMulti(keys, { quiet: true });
				deletedCount += keys.length;
			}
			marker = result.isTruncated ? result.nextMarker : undefined;
		} while (marker);
		this.logger.log(`[OSS删除] 课程预览缓存清理完成: prefix=${safePrefix}, count=${deletedCount}`);
		return deletedCount;
	}

	/** @deprecated 请使用 deleteByUrl，保留兼容 */
	async deleteImage(fileUrl: string): Promise<void> {
		return this.deleteByUrl(fileUrl);
	}

	/**
	 * 获取 OSS 直传签名 URL（用于前端直传，绕过云托管 413 限制）
	 * @param path 云端路径，不要以 / 开头，如 course-files/xxx.pdf
	 */
	async getDirectUploadUrl(
		cloudPath: string,
		contentType = 'application/octet-stream',
	): Promise<{
		url: string;
		method: 'PUT';
		contentType: string;
		headers: Record<string, string>;
		path: string;
		finalFileUrl: string;
	}> {
		const safeKey = this.normalizeObjectKey(cloudPath);
		const headers: Record<string, string> = { 'Content-Type': contentType };
		const signatureOptions: any = {
			expires: 15 * 60,
			method: 'PUT',
			'Content-Type': contentType,
		};
		const url = this.requireOss().signatureUrl(safeKey, signatureOptions);
		return {
			url,
			method: 'PUT',
			contentType,
			headers,
			path: safeKey,
			finalFileUrl: this.getObjectUrl(safeKey),
		};
	}

	/**
	 * 获取 OSS 表单直传凭证。微信小程序的 uploadFile 仅支持 multipart 表单，使用此接口直传 OSS。
	 */
	getPostUploadCredentials(
		cloudPath: string,
		contentType = 'application/octet-stream',
		maxBytes = 300 * 1024 * 1024,
	): {
		url: string;
		method: 'POST';
		fields: Record<string, string>;
		path: string;
		finalFileUrl: string;
	} {
		this.requireOss();
		const safeKey = this.normalizeObjectKey(cloudPath);
		const accessKeyId = this.configService.get<string>('OSS_ACCESS_KEY_ID');
		const accessKeySecret = this.configService.get<string>('OSS_ACCESS_KEY_SECRET');
		if (!accessKeyId || !accessKeySecret) {
			throw new BadRequestException('阿里云 OSS 配置不完整');
		}
		const policy = Buffer.from(
			JSON.stringify({
				expiration: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
				conditions: [
					['eq', '$key', safeKey],
					['eq', '$Content-Type', contentType],
					['content-length-range', 1, maxBytes],
				],
			}),
		).toString('base64');
		const signature = createHmac('sha1', accessKeySecret).update(policy).digest('base64');
		return {
			url: this.originBaseUrl,
			method: 'POST',
			fields: {
				key: safeKey,
				policy,
				OSSAccessKeyId: accessKeyId,
				Signature: signature,
				'Content-Type': contentType,
				success_action_status: '200',
			},
			path: safeKey,
			finalFileUrl: this.getObjectUrl(safeKey),
		};
	}

	/**
	 * 上传课程文件（PDF/Word），用于「文件类型」课程内容
	 * 支持：.pdf, .doc, .docx（直传方案可绕过 413，建议管理端使用 getDirectUploadUrl + 前端直传）
	 */
	async uploadCourseFile(file: Express.Multer.File, openid: string = ''): Promise<string> {
		if (!file) {
			throw new BadRequestException('文件不能为空');
		}
		const allowedMimeTypes = [
			'application/pdf',
			'application/msword', // .doc
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
		];
		if (!allowedMimeTypes.includes(file.mimetype)) {
			throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
		}
		const ext = this.getFileExtension(file.originalname).toLowerCase();
		const allowedExts = ['.pdf', '.doc', '.docx'];
		if (!allowedExts.includes(ext)) {
			throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
		}
		const folder = 'course-files/staging';
		if (this.isObjectStorageEnabled()) {
			return this.uploadCourseFileToOss(file, folder);
		}
		return this.uploadCourseFileToLocal(file, folder);
	}

	private async uploadCourseFileToLocal(file: Express.Multer.File, folder: string): Promise<string> {
		const allowedExts = ['.pdf', '.doc', '.docx'];
		const relativePath = await this.saveFileToLocalWithExts(file, folder, allowedExts);
		const fileUrl = `${this.baseUrl}/uploads/${relativePath}`;
		console.log(`[本地存储] 课程文件上传成功: ${fileUrl}`);
		return fileUrl;
	}

	private async saveFileToLocalWithExts(
		file: Express.Multer.File,
		folder: string,
		allowedExts: string[],
	): Promise<string> {
		if (!this.isValidFilename(file.originalname)) {
			throw new BadRequestException('文件名包含不安全字符');
		}
		if (!this.isValidFolder(folder)) {
			throw new BadRequestException('文件夹名称包含不安全字符');
		}
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const ext = this.getFileExtension(file.originalname).toLowerCase();
		if (!allowedExts.includes(ext)) {
			throw new BadRequestException(`不支持的文件类型: ${ext}`);
		}
		const fileName = `${timestamp}-${randomStr}${ext}`;
		const folderPath = path.join(this.uploadDir, folder);
		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath, { recursive: true });
		}
		const filePath = path.join(folderPath, fileName);
		const resolvedPath = path.resolve(filePath);
		const resolvedUploadDir = path.resolve(this.uploadDir);
		if (!resolvedPath.startsWith(resolvedUploadDir)) {
			throw new BadRequestException('文件路径不安全');
		}
		const buffer = (file as any).buffer;
		if (buffer) {
			await fs.promises.writeFile(filePath, buffer);
			return `${folder}/${fileName}`;
		}
		if (file.path && fs.existsSync(file.path)) {
			await fs.promises.copyFile(file.path, filePath);
			return `${folder}/${fileName}`;
		}
		throw new BadRequestException('无法读取文件内容');
	}

	private async uploadCourseFileToOss(file: Express.Multer.File, folder: string): Promise<string> {
		const allowedExts = ['.pdf', '.doc', '.docx'];
		const ext = this.getFileExtension(file.originalname).toLowerCase();
		if (!allowedExts.includes(ext)) {
			throw new BadRequestException('仅支持 PDF、Word 文件');
		}
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const fileName = `${folder}/${timestamp}-${randomStr}${ext}`;
		const buffer = (file as any).buffer;
		const filePath = file.path && fs.existsSync(file.path) ? file.path : '';
		if (!buffer && !filePath) {
			throw new BadRequestException('无法读取文件内容');
		}
		await this.requireOss().put(fileName, buffer || fs.createReadStream(filePath), {
			headers: { 'Content-Type': file.mimetype },
		});
		const fileUrl = this.getObjectUrl(fileName);
		console.log(`[OSS上传] 课程文件成功: ${fileUrl}`);
		return fileUrl;
	}

	/**
	 * 上传 PDF 到对象存储（用于「先上传再解析」流程）
	 * 本地环境存到 uploads/pdf/，线上存到 OSS pdf/
	 */
	async uploadPdf(file: Express.Multer.File): Promise<string> {
		if (!file) {
			throw new BadRequestException('文件不能为空');
		}
		const ext = this.getFileExtension(file.originalname);
		if (ext.toLowerCase() !== '.pdf') {
			throw new BadRequestException('仅支持 PDF 文件');
		}
		const buffer = await this.getPdfBuffer(file);
		if (this.isObjectStorageEnabled()) {
			return this.uploadPdfToOss(buffer);
		}
		return this.uploadPdfToLocal(buffer);
	}

	private getPdfBuffer(file: Express.Multer.File): Promise<Buffer> {
		const f = file as Express.Multer.File & { buffer?: Buffer };
		if (f.buffer && f.buffer.length > 0) {
			return Promise.resolve(Buffer.isBuffer(f.buffer) ? f.buffer : Buffer.from(f.buffer));
		}
		if (file.path && fs.existsSync(file.path)) {
			return fs.promises.readFile(file.path);
		}
		return Promise.reject(new BadRequestException('无法读取 PDF 内容'));
	}

	private async uploadPdfToLocal(buffer: Buffer): Promise<string> {
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const fileName = `pdf/${timestamp}-${randomStr}.pdf`;
		const folderPath = path.join(this.uploadDir, 'pdf');
		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath, { recursive: true });
		}
		const filePath = path.join(this.uploadDir, fileName);
		fs.writeFileSync(filePath, buffer);
		return `${this.baseUrl}/uploads/${fileName}`;
	}

	private async uploadPdfToOss(buffer: Buffer): Promise<string> {
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const fileName = `pdf/${timestamp}-${randomStr}.pdf`;
		await this.requireOss().put(fileName, buffer, {
			headers: { 'Content-Type': 'application/pdf' },
		});
		return this.getObjectUrl(fileName);
	}

	/**
	 * 上传 Buffer 到当前对象存储桶，供服务端生成的缓存文件复用。
	 */
	async uploadBufferToOss(key: string, buffer: Buffer, contentType = 'application/octet-stream'): Promise<string> {
		const safeKey = this.normalizeObjectKey(key);
		await this.requireOss().put(safeKey, buffer, {
			headers: {
				'Content-Type': contentType,
			},
		});
		return this.getObjectUrl(safeKey);
	}

	async objectExists(key: string): Promise<boolean> {
		const safeKey = this.normalizeObjectKey(key);
		try {
			await this.requireOss().head(safeKey);
			return true;
		} catch {
			return false;
		}
	}

	async readObjectBuffer(key: string): Promise<Buffer | null> {
		const safeKey = this.normalizeObjectKey(key);
		try {
			const result = await this.requireOss().get(safeKey);
			const body = (result as any)?.content;
			if (Buffer.isBuffer(body)) return body;
			if (body instanceof Uint8Array) return Buffer.from(body);
			if (typeof body === 'string') return Buffer.from(body);
			return null;
		} catch {
			return null;
		}
	}

	async readObjectUrlBuffer(url: string): Promise<Buffer | null> {
		if (!this.isAllowedProxyUrl(url)) {
			return null;
		}
		const key = this.extractKeyFromUrl(url);
		if (!key) {
			return null;
		}
		return this.readObjectBuffer(key);
	}

	getObjectUrl(key: string): string {
		return `${this.publicBaseUrl}/${this.normalizeObjectKey(key).split('/').map(encodeURIComponent).join('/')}`;
	}

	private normalizeObjectKey(key: string): string {
		const safeKey = String(key || '').replace(/^\/+/, '');
		if (!safeKey || safeKey.includes('..') || safeKey.includes('\\')) {
			throw new BadRequestException('对象存储路径不安全');
		}
		return safeKey;
	}

	/** 分片临时目录：uploads/temp/{uploadId}/ */
	private getChunkTempDir(uploadId: string): string {
		const safe = (uploadId || '').replace(/[^a-zA-Z0-9-_]/g, '');
		if (!safe || safe.length > 64) {
			throw new BadRequestException('uploadId 格式无效');
		}
		return path.join(this.uploadDir, 'temp', safe);
	}

	/**
	 * 保存课程文件的一个分片（大文件分片上传）
	 */
	async saveCourseFileChunk(uploadId: string, chunkIndex: number, totalChunks: number, buffer: Buffer): Promise<void> {
		if (totalChunks < 1 || totalChunks > 500) {
			throw new BadRequestException('totalChunks 需在 1～500 之间');
		}
		if (chunkIndex < 0 || chunkIndex >= totalChunks) {
			throw new BadRequestException('chunkIndex 超出范围');
		}
		const dir = this.getChunkTempDir(uploadId);
		const resolvedDir = path.resolve(dir);
		const resolvedUploadDir = path.resolve(this.uploadDir);
		if (!resolvedDir.startsWith(resolvedUploadDir) || resolvedDir === resolvedUploadDir) {
			throw new BadRequestException('路径不安全');
		}
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const chunkPath = path.join(dir, String(chunkIndex));
		fs.writeFileSync(chunkPath, buffer);
	}

	/**
	 * 合并课程文件分片并保存（本地或 OSS），返回最终 fileUrl
	 */
	async mergeCourseFileChunks(uploadId: string, totalChunks: number, fileName: string): Promise<string> {
		const ext = this.getFileExtension(fileName || '').toLowerCase();
		if (!['.pdf', '.doc', '.docx'].includes(ext)) {
			throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
		}
		const dir = this.getChunkTempDir(uploadId);
		if (!fs.existsSync(dir)) {
			throw new BadRequestException('未找到该上传任务的分片，请先上传全部分片');
		}
		const mergedFileName = `merged-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
		const mergedPath = path.join(dir, mergedFileName);
		if (fs.existsSync(mergedPath)) {
			await fs.promises.unlink(mergedPath);
		}
		for (let i = 0; i < totalChunks; i++) {
			const chunkPath = path.join(dir, String(i));
			if (!fs.existsSync(chunkPath)) {
				throw new BadRequestException(`缺少分片 ${i}，请补传`);
			}
			await fs.promises.appendFile(mergedPath, await fs.promises.readFile(chunkPath));
		}
		const mimeMap: Record<string, string> = {
			'.pdf': 'application/pdf',
			'.doc': 'application/msword',
			'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		};
		const mimetype = mimeMap[ext] || 'application/octet-stream';
		const stat = await fs.promises.stat(mergedPath);
		const fakeFile: Express.Multer.File = {
			fieldname: 'file',
			originalname: fileName || `merged${ext}`,
			encoding: '7bit',
			mimetype,
			size: stat.size,
			buffer: undefined as any,
			stream: null as any,
			destination: '',
			filename: mergedFileName,
			path: mergedPath,
		};
		try {
			const fileUrl = await this.uploadCourseFile(fakeFile, '');
			return fileUrl;
		} finally {
			try {
				for (let i = 0; i < totalChunks; i++) {
					const chunkPath = path.join(dir, String(i));
					if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
				}
				if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath);
				if (fs.existsSync(dir)) fs.rmdirSync(dir);
			} catch (e) {
				console.warn('[分片合并] 清理临时目录失败:', e);
			}
		}
	}

	/**
	 * 获取文件扩展名
	 */
	private getFileExtension(filename: string): string {
		const lastDot = filename.lastIndexOf('.');
		return lastDot !== -1 ? filename.substring(lastDot) : '.jpg';
	}

	/**
	 * 从 URL 中提取对象存储 Key
	 */
	private extractKeyFromUrl(url: string): string | null {
		try {
			const normalized = String(url || '').trim();
			const cloudPrefix = this.getLegacyCloudPrefix();
			if (cloudPrefix && normalized.startsWith(cloudPrefix)) {
				const rawKey = normalized.slice(cloudPrefix.length).split(/[?#]/, 1)[0];
				return decodeURIComponent(rawKey.replace(/^\/+/, '')) || null;
			}
			const parsed = new URL(url);
			if (!this.isAllowedProxyUrl(url)) return null;
			return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || null;
		} catch {
			return null;
		}
	}

	/**
	 * 判断 URL 是否为本项目对象存储域名（仅允许代理自家存储，防止滥用）
	 */
	isAllowedProxyUrl(url: string): boolean {
		if (!url || typeof url !== 'string') return false;
		const normalized = url.trim();
		const cloudPrefix = this.getLegacyCloudPrefix();
		if (cloudPrefix && normalized.startsWith(cloudPrefix)) {
			return Boolean(this.extractLegacyCloudKey(normalized));
		}
		if (!normalized.startsWith('https://')) return false;
		try {
			const u = new URL(normalized);
			const publicHost = new URL(this.publicBaseUrl).hostname;
			const allowedHosts = new Set([
				publicHost,
				`${this.bucket}.${this.region}.aliyuncs.com`,
				`${this.bucket}.oss-accelerate.aliyuncs.com`,
			]);
			if (this.legacyCosBucket) {
				allowedHosts.add(`${this.legacyCosBucket}.tcb.qcloud.la`);
				allowedHosts.add(`${this.legacyCosBucket}.cos.ap-shanghai.myqcloud.com`);
			}
			return allowedHosts.has(u.hostname);
		} catch {
			return false;
		}
	}

	private getLegacyCloudPrefix(): string {
		if (!this.legacyCosEnvId || !this.legacyCosBucket) return '';
		return `cloud://${this.legacyCosEnvId}.${this.legacyCosBucket}/`;
	}

	private extractLegacyCloudKey(url: string): string | null {
		const prefix = this.getLegacyCloudPrefix();
		if (!prefix || !url.startsWith(prefix)) return null;
		try {
			const key = decodeURIComponent(url.slice(prefix.length).split(/[?#]/, 1)[0]).replace(/^\/+/, '');
			return key && !key.includes('..') && !key.includes('\\') ? key : null;
		} catch {
			return null;
		}
	}

	/**
	 * 从 OSS 拉取图片并返回 buffer 与 contentType（用于私有 Bucket 和管理端跨域场景）
	 */
	async proxyImage(url: string): Promise<{ data: Buffer; contentType: string }> {
		if (!this.isAllowedProxyUrl(url)) {
			throw new BadRequestException('仅允许代理本项目的 OSS 图片地址');
		}
		const key = this.extractKeyFromUrl(url);
		if (!key) throw new BadRequestException('OSS 图片地址无效');
		try {
			const result = await this.requireOss().get(key);
			const data = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content as any);
			const contentType = (result.res?.headers?.['content-type'] as string) || this.sniffImageMime(data) || 'image/png';
			return { data, contentType };
		} catch (error: any) {
			const fallbackUrl = this.getLegacyCosFallbackUrl(url, key);
			if (fallbackUrl) {
				try {
					const response = await axios.get<ArrayBuffer>(fallbackUrl, {
						responseType: 'arraybuffer',
						timeout: 15_000,
						maxContentLength: 20 * 1024 * 1024,
					});
					const data = Buffer.from(response.data);
					const contentType =
						String(response.headers['content-type'] || '').split(';')[0] || this.sniffImageMime(data) || 'image/png';
					this.logger.warn(`OSS 对象读取失败，已回源腾讯云: ${key}`);
					return { data, contentType };
				} catch (legacyError: any) {
					throw new BadRequestException(
						`OSS 与腾讯云均无法读取图片: ${legacyError?.message || error?.message || '未知错误'}`,
					);
				}
			}
			throw new BadRequestException(`拉取 OSS 图片失败: ${error?.message || '未知错误'}`);
		}
	}

	private getLegacyCosFallbackUrl(url: string, key: string): string | null {
		if (this.isLegacyCosHttpsUrl(url)) return url;
		if (!this.extractLegacyCloudKey(url)) return null;
		const encodedKey = key.split('/').map(encodeURIComponent).join('/');
		return `https://${this.legacyCosBucket}.tcb.qcloud.la/${encodedKey}`;
	}

	private isLegacyCosHttpsUrl(url: string): boolean {
		try {
			const host = new URL(url).hostname;
			return (
				host === `${this.legacyCosBucket}.tcb.qcloud.la` ||
				host === `${this.legacyCosBucket}.cos.ap-shanghai.myqcloud.com`
			);
		} catch {
			return false;
		}
	}

	private isImageContentType(contentType: string): boolean {
		return /^image\/(jpeg|jpg|png|gif|webp)/i.test(
			String(contentType || '')
				.split(';')[0]
				.trim(),
		);
	}

	private sniffImageMime(buf: Buffer): string | null {
		if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
			return 'image/jpeg';
		}
		if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
			return 'image/png';
		}
		if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
			return 'image/gif';
		}
		if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
			return 'image/webp';
		}
		return null;
	}
}
