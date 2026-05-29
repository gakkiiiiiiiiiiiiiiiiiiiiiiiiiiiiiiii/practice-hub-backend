import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as COS from 'cos-nodejs-sdk-v5';
import axios from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface TempAuth {
	TmpSecretId: string;
	TmpSecretKey: string;
	Token: string;
	ExpiredTime: number;
}

interface MetaDataResponse {
	errcode: number;
	errmsg: string;
	respdata: {
		x_cos_meta_field_strs: string[];
	};
}

@Injectable()
export class UploadService {
	private readonly logger = new Logger(UploadService.name);
	private cos: COS;
	private bucket: string;
	private region: string;
	private tempAuth: TempAuth | null = null;
	private authExpireTime: number = 0;
	private uploadDir: string;
	private baseUrl: string;
	private uploadCredentialInternalSkipUntil = 0;
	private wechatTlsCompatWarned = false;

	constructor(private configService: ConfigService) {
		this.bucket = this.configService.get<string>('COS_BUCKET', '7072-prod-6g7tpqs40c5a758b-1392943725');
		this.region = this.configService.get<string>('COS_REGION', 'ap-shanghai');

		// 本地存储配置（可通过 UPLOAD_DIR 覆盖；容器内默认 uploads）
		this.uploadDir = this.configService.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads');

		// 获取基础 URL，优先使用环境变量，否则根据端口自动判断
		const port = parseInt(process.env.PORT || '8080', 10);
		this.baseUrl = this.configService.get<string>('BASE_URL') || `http://localhost:${port}`;

		// 确保上传目录存在
		this.ensureUploadDir();

		// 初始化 COS 客户端，使用 getAuthorization 方式
		this.cos = new COS({
			getAuthorization: async (options, callback) => {
				try {
					const auth = await this.getTempAuth();
					const now = Math.floor(Date.now() / 1000);
					callback({
						TmpSecretId: auth.TmpSecretId,
						TmpSecretKey: auth.TmpSecretKey,
						SecurityToken: auth.Token,
						ExpiredTime: auth.ExpiredTime,
						StartTime: now, // 临时密钥开始时间
					});
				} catch (error: any) {
					const now = Math.floor(Date.now() / 1000);
					callback({
						TmpSecretId: '',
						TmpSecretKey: '',
						SecurityToken: '',
						ExpiredTime: 0,
						StartTime: now,
					});
					console.error('[COS授权] 获取临时密钥失败:', error.message);
				}
			},
		});
	}

	/**
	 * 获取临时密钥（参考微信云托管文档）
	 * https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/storage/service/cos-sdk.html
	 */
	private async getTempAuth(): Promise<TempAuth> {
		// 如果临时密钥未过期，直接返回
		const now = Math.floor(Date.now() / 1000);
		if (this.tempAuth && this.authExpireTime > now + 60) {
			// 提前60秒刷新，避免过期
			return this.tempAuth;
		}

		try {
			// 微信云托管内部 API 使用 http（参考 demo）
			const response = await axios.get('http://api.weixin.qq.com/_/cos/getauth');
			const authData = response.data;

			if (!authData.TmpSecretId || !authData.TmpSecretKey) {
				throw new Error('获取临时密钥失败：返回数据不完整');
			}

			this.tempAuth = {
				TmpSecretId: authData.TmpSecretId,
				TmpSecretKey: authData.TmpSecretKey,
				Token: authData.Token,
				ExpiredTime: authData.ExpiredTime,
			};
			this.authExpireTime = authData.ExpiredTime;

			console.log('[COS授权] 临时密钥获取成功');
			return this.tempAuth;
		} catch (error: any) {
			console.error('[COS授权] 获取临时密钥失败:', error.message);
			throw new Error(`获取临时密钥失败: ${error.message}`);
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
			this.logger.warn(
				`无法创建上传目录 ${this.uploadDir}（${error?.message || error}），改用 ${fallbackDir}`,
			);
			this.uploadDir = fallbackDir;
			if (!fs.existsSync(this.uploadDir)) {
				fs.mkdirSync(this.uploadDir, { recursive: true });
			}
		}
	}

	/**
	 * 检查是否在微信云托管环境
	 */
	private isWeChatCloudBase(): boolean {
		// 检查环境变量或请求头，判断是否在微信云托管环境
		// 微信云托管会设置特定的环境变量或请求头
		return !!(
			process.env.WX_CLOUD_ENV ||
			process.env.WX_CLOUDBASE_ENV ||
			process.env.TCB_ENV ||
			process.env.COS_BUCKET ||
			// 检查是否能访问微信云托管内部 API
			process.env.WX_CLOUD_RUN_ENV === 'true'
		);
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
	 * 获取文件元数据（必须，否则小程序端无法访问）
	 * @param cloudPath 云上文件路径
	 * @param openid 用户openid，管理端传空字符串
	 */
	private async getFileMetaData(cloudPath: string, openid: string = ''): Promise<string | null> {
		// 如果不在微信云托管环境，返回 null，跳过元数据设置
		if (!this.isWeChatCloudBase()) {
			console.warn('[COS元数据] 非微信云托管环境，跳过元数据获取');
			return null;
		}

		try {
			// 微信云托管内部 API 使用 http（参考 demo）
			const response = await axios.post(
				'http://api.weixin.qq.com/_/cos/metaid/encode',
				{
					openid: openid, // 管理端上传时传空字符串
					bucket: this.bucket,
					paths: [cloudPath],
				},
				{
					timeout: 5000, // 5秒超时
				}
			);

			const result: MetaDataResponse = response.data;

			if (result.errcode !== 0) {
				throw new Error(`获取文件元数据失败: ${result.errmsg}`);
			}

			if (!result.respdata?.x_cos_meta_field_strs?.[0]) {
				throw new Error('获取文件元数据失败：返回数据不完整');
			}

			return result.respdata.x_cos_meta_field_strs[0];
		} catch (error: any) {
			// 如果是 404 错误，说明不在微信云托管环境，返回 null
			if (error.response?.status === 404 || error.code === 'ECONNREFUSED') {
				console.warn('[COS元数据] 微信云托管 API 不可用，跳过元数据获取');
				return null;
			}
			console.error('[COS元数据] 获取失败:', error.message);
			throw new Error(`获取文件元数据失败: ${error.message}`);
		}
	}

	/**
	 * 上传图片（根据环境选择存储方式）
	 * @param file 文件对象
	 * @param folder 存储文件夹（可选，默认为 images）
	 * @param openid 用户openid（可选，管理端上传时可不传）
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
		if (this.isWeChatCloudBase()) {
			return this.uploadToCOS(file, folder, openid);
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
	 * 上传图片到 COS
	 * @param file 文件对象
	 * @param folder 存储文件夹（可选，默认为 images）
	 * @param openid 用户openid（可选，管理端上传时可不传）
	 * @returns 图片 URL
	 */
	private async uploadToCOS(
		file: Express.Multer.File,
		folder: string = 'images',
		openid: string = ''
	): Promise<string> {
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
		const cloudPath = `/${fileName}`;

		try {
			// 1. 获取文件元数据（微信云托管环境必须，否则小程序端无法访问）
			const metaFileId = await this.getFileMetaData(cloudPath, openid);

			// 2. 上传到 COS，如果获取到元数据则添加 x-cos-meta-fileid（参考 demo）
			const uploadOptions: any = {
				Bucket: this.bucket,
				Region: this.region,
				Key: fileName,
				Body: file.buffer,
				ContentType: file.mimetype,
				ContentLength: file.size, // 添加 ContentLength（参考 demo）
				StorageClass: 'STANDARD',
			};

			// 只有在微信云托管环境且有元数据时才添加 x-cos-meta-fileid
			if (metaFileId) {
				uploadOptions.Headers = {
					'x-cos-meta-fileid': metaFileId,
				};
			}

			const result = await this.cos.putObject(uploadOptions);
			console.log('[COS上传] 上传结果:', { statusCode: result.statusCode, Location: result.Location });

			if (result.statusCode !== 200 && result.statusCode !== 204) {
				throw new Error(`上传失败，状态码: ${result.statusCode}`);
			}

			// 3. 获取可访问的图片 URL
			// 优先使用返回的 Location，否则使用默认格式
			let imageUrl = '';
			// if (result.Location) {
			// 	imageUrl = result.Location.startsWith('http') ? result.Location : `https://${result.Location}`;
			// } else {
			// 	// 微信云托管环境使用 tcb 域名
			// 	imageUrl = `https://${this.bucket}.tcb.qcloud.la/${fileName}`;
			// }
			imageUrl = `https://${this.bucket}.tcb.qcloud.la/${fileName}`;

			console.log(`[COS上传] 成功: ${imageUrl}, 元数据: ${metaFileId || '未设置'}`);
			return imageUrl;
		} catch (error: any) {
			console.error('[COS上传] 失败:', error);
			throw new BadRequestException(`图片上传失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 根据 URL 删除文件（本地或 COS），供图片、PDF 等统一使用
	 * @param fileUrl 文件 URL
	 */
	async deleteByUrl(fileUrl: string): Promise<void> {
		if (!fileUrl || typeof fileUrl !== 'string') return;
		try {
			// 判断是本地文件还是 COS 文件
			if (fileUrl.includes('/uploads/')) {
				// 本地文件
				const relativePath = fileUrl.split('/uploads/')[1];
				const filePath = path.join(this.uploadDir, relativePath);
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
					console.log(`[本地存储] 删除成功: ${filePath}`);
				}
			} else {
				// COS 文件
				const key = this.extractKeyFromUrl(fileUrl);
				if (!key) {
					throw new BadRequestException('无效的文件 URL');
				}

				await this.cos.deleteObject({
					Bucket: this.bucket,
					Region: this.region,
					Key: key,
				});

				console.log(`[COS删除] 成功: ${key}`);
			}
		} catch (error: any) {
			console.error('[删除文件] 失败:', error);
			// 删除失败不抛出异常，避免影响主流程
		}
	}

	/** @deprecated 请使用 deleteByUrl，保留兼容 */
	async deleteImage(fileUrl: string): Promise<void> {
		return this.deleteByUrl(fileUrl);
	}

	/**
	 * 获取课程文件直传 COS 的上传凭证（用于前端直传，绕过云托管 413 限制）
	 * 参考：https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/storage/service/upload.html
	 * @param path 云端路径，不要以 / 开头，如 course-files/xxx.pdf
	 */
	async getCourseFileUploadUrl(cloudPath: string): Promise<{
		url: string;
		token: string;
		authorization: string;
		cos_file_id: string;
		file_id: string;
		path: string;
		finalFileUrl: string;
	}> {
		const envId = this.configService.get<string>('CBR_ENV_ID') || this.configService.get<string>('TCB_ENV_ID') || this.getEnvIdFromBucket();
		if (!envId) {
			throw new BadRequestException('未配置 CBR_ENV_ID 或 TCB_ENV_ID，无法获取直传凭证');
		}
		const pathNorm = cloudPath.replace(/^\//, '');
		const inCloudRun = process.env.WX_CLOUD_RUN_ENV === 'true' || this.isWeChatCloudBase();
		const uploadMode = String(this.configService.get<string>('WECHAT_TCB_UPLOAD_MODE') || 'auto').toLowerCase();
		const forcePublicUploadApi = uploadMode === 'public';
		const shouldSkipInternalApi = forcePublicUploadApi || Date.now() < this.uploadCredentialInternalSkipUntil;
		const buildUploadCredential = (data: any) => {
			if (!data.url || !data.authorization || !data.token || !data.cos_file_id) {
				throw new Error('获取上传链接返回数据不完整');
			}
			const finalFileUrl = `https://${this.bucket}.tcb.qcloud.la/${pathNorm}`;
			return {
				url: data.url,
				token: data.token,
				authorization: data.authorization,
				cos_file_id: data.cos_file_id,
				file_id: data.file_id || '',
				path: pathNorm,
				finalFileUrl,
			};
		};
		const requestPublicUploadCredential = async (successLog: string) => {
			try {
				const token = await this.getWeChatAccessToken();
				const publicRes = await this.requestWechatPublicApi(
					`https://api.weixin.qq.com/tcb/uploadfile?access_token=${token}`,
					{ env: envId, path: pathNorm },
				);
				const data = publicRes.data;
				if (data.errcode && data.errcode !== 0) {
					throw new Error(data.errmsg || `公网接口失败: ${data.errcode}`);
				}
				const credential = buildUploadCredential(data);
				console.log(successLog);
				return credential;
			} catch (fallbackErr: any) {
				const fbMsg = fallbackErr?.response?.data?.errmsg || fallbackErr.message;
				console.error('[直传凭证] 公网接口失败:', fbMsg);
				const configHint = fbMsg?.includes('未配置') ? '请确认已配置 WECHAT_APPID、WECHAT_SECRET：' : '公网接口错误：';
				throw new BadRequestException('获取上传凭证失败。' + configHint + (fbMsg || ''));
			}
		};

		if (shouldSkipInternalApi) {
			return requestPublicUploadCredential(
				forcePublicUploadApi
					? '[直传凭证] 已按 WECHAT_TCB_UPLOAD_MODE=public 使用公网 tcb/uploadfile 获取成功'
					: '[直传凭证] 已跳过临时不可用的内网接口，通过公网 tcb/uploadfile 获取成功',
			);
		}

		// 先尝试云托管内网 _/tcb/uploadfile（无需 access_token）；若返回 85107 再走公网 + access_token
		try {
			const apiUrl = inCloudRun
				? 'http://api.weixin.qq.com/_/tcb/uploadfile'
				: `https://api.weixin.qq.com/tcb/uploadfile`;
			const res = await axios.post(
				apiUrl,
				{ env: envId, path: pathNorm },
				{ timeout: 10000 },
			);
			const data = res.data;
			if (data.errcode && data.errcode !== 0) {
				throw new Error(data.errmsg || `获取上传链接失败: ${data.errcode}`);
			}
			return buildUploadCredential(data);
		} catch (error: any) {
			const body = error?.response?.data;
			const code = body?.error_code ?? body?.errcode;
			const status = error?.response?.status;
			const msg = body?.error_message ?? body?.errmsg ?? error.message;
			const isWhitelistError = this.isWechatSafeLinkWhitelistError(body) || code === '85107' || code === 85107;
			if (isWhitelistError) {
				this.uploadCredentialInternalSkipUntil = Date.now() + 30 * 60 * 1000;
				console.warn(
					'[直传凭证] 内网云调用未配置微信令牌白名单，30分钟内直接使用公网接口兜底。建议在环境变量设置 WECHAT_TCB_UPLOAD_MODE=public，或到云托管控制台配置 /_/tcb/uploadfile 白名单。',
				);
			} else {
				console.error('[直传凭证] 获取失败:', status || '', body || error.message);
			}

			// 云托管内：内网 404/85107 等失败时，统一尝试公网 tcb/uploadfile + access_token
			if (inCloudRun) {
				return requestPublicUploadCredential('[直传凭证] 已通过公网 tcb/uploadfile + access_token 获取成功');
			}

			if (code === '85107' || code === 85107) {
				throw new BadRequestException(
					'URL 未加入白名单。请前往「微信云托管控制台 → 服务管理 → 云调用 → 微信令牌」在权限配置中添加：/tcb/uploadfile 或 /_/tcb/uploadfile',
				);
			}
			throw new BadRequestException(msg || '获取上传凭证失败');
		}
	}

	/** 使用小程序 appid/secret 获取 access_token，用于公网 tcb/uploadfile 等接口 */
	private async getWeChatAccessToken(): Promise<string> {
		const appid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
		const secret =
			this.configService.get<string>('WECHAT_SECRET') ||
			this.configService.get<string>('WECHAT_APPSECRET') ||
			this.configService.get<string>('AppSecret');
		if (!appid || !secret) {
			throw new Error('未配置 WECHAT_APPID 或 WECHAT_SECRET，无法使用公网 tcb/uploadfile');
		}
		const res = await this.requestWechatPublicApi('https://api.weixin.qq.com/cgi-bin/token', null, {
			grant_type: 'client_credential',
			appid,
			secret,
		});
		if (res.data.errcode) {
			throw new Error(res.data.errmsg || `获取 access_token 失败: ${res.data.errcode}`);
		}
		return res.data.access_token;
	}

	private async requestWechatPublicApi(url: string, data?: Record<string, any> | null, params?: Record<string, any>) {
		try {
			if (data) {
				return await axios.post(url, data, { params, timeout: 10000 });
			}
			return await axios.get(url, { params, timeout: 10000 });
		} catch (error: any) {
			if (!this.isTlsCertificateError(error)) {
				throw error;
			}

			if (!this.wechatTlsCompatWarned) {
				this.wechatTlsCompatWarned = true;
				console.warn('[微信公网接口] TLS 证书校验失败，使用兼容模式重试:', error.message);
			}
			const requestConfig = {
				params,
				timeout: 10000,
				httpsAgent: new https.Agent({ rejectUnauthorized: false }),
			};
			if (data) {
				return axios.post(url, data, requestConfig);
			}
			return axios.get(url, requestConfig);
		}
	}

	private isTlsCertificateError(error: any): boolean {
		const code = error?.code || error?.cause?.code;
		const message = String(error?.message || error?.cause?.message || '').toLowerCase();
		return (
			code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
			code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
			code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
			message.includes('self-signed certificate') ||
			message.includes('unable to verify the first certificate')
		);
	}

	private isWechatSafeLinkWhitelistError(body: any): boolean {
		const errorType = String(body?.error_type || '');
		const message = String(body?.error_message || body?.errmsg || '');
		return errorType === 'SafeLinkError' || message.includes('URL不在白名单内') || message.includes('URL 未加入白名单');
	}

	private getEnvIdFromBucket(): string {
		// 从 bucket 名 7072-prod-6g7tpqs40c5a758b-1392943725 推断 env 多为中间段
		const m = this.bucket.match(/^[^-]+-(.+)-[^-]+$/);
		return m ? m[1] : '';
	}

	/**
	 * 上传课程文件（PDF/Word），用于「文件类型」课程内容
	 * 支持：.pdf, .doc, .docx（直传方案可绕过 413，建议管理端使用 getCourseFileUploadUrl + 前端直传）
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
		const folder = 'course-files';
		if (this.isWeChatCloudBase()) {
			return this.uploadCourseFileToCOS(file, folder, openid);
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
		if (!this.isValidFilename(folder)) {
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

	private async uploadCourseFileToCOS(
		file: Express.Multer.File,
		folder: string,
		openid: string,
	): Promise<string> {
		const allowedExts = ['.pdf', '.doc', '.docx'];
		const ext = this.getFileExtension(file.originalname).toLowerCase();
		if (!allowedExts.includes(ext)) {
			throw new BadRequestException('仅支持 PDF、Word 文件');
		}
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const fileName = `${folder}/${timestamp}-${randomStr}${ext}`;
		const cloudPath = `/${fileName}`;
		const metaFileId = await this.getFileMetaData(cloudPath, openid);
		const buffer = (file as any).buffer;
		const filePath = file.path && fs.existsSync(file.path) ? file.path : '';
		if (!buffer && !filePath) {
			throw new BadRequestException('无法读取文件内容');
		}
		const uploadOptions: any = {
			Bucket: this.bucket,
			Region: this.region,
			Key: fileName,
			Body: buffer || fs.createReadStream(filePath),
			ContentType: file.mimetype,
			ContentLength: buffer ? buffer.length : (await fs.promises.stat(filePath)).size,
			StorageClass: 'STANDARD',
		};
		if (metaFileId) {
			uploadOptions.Headers = { 'x-cos-meta-fileid': metaFileId };
		}
		await this.cos.putObject(uploadOptions);
		const fileUrl = `https://${this.bucket}.tcb.qcloud.la/${fileName}`;
		console.log(`[COS上传] 课程文件成功: ${fileUrl}`);
		return fileUrl;
	}

	/**
	 * 上传 PDF 到对象存储（用于「先上传再解析」流程）
	 * 本地环境存到 uploads/pdf/，微信云托管存到 COS pdf/
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
		if (this.isWeChatCloudBase()) {
			return this.uploadPdfToCOS(buffer, file.size);
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

	private async uploadPdfToCOS(buffer: Buffer, size: number): Promise<string> {
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const fileName = `pdf/${timestamp}-${randomStr}.pdf`;
		const cloudPath = `/${fileName}`;
		const metaFileId = await this.getFileMetaData(cloudPath, '');
		const uploadOptions: any = {
			Bucket: this.bucket,
			Region: this.region,
			Key: fileName,
			Body: buffer,
			ContentType: 'application/pdf',
			ContentLength: size,
			StorageClass: 'STANDARD',
		};
		if (metaFileId) {
			uploadOptions.Headers = { 'x-cos-meta-fileid': metaFileId };
		}
		await this.cos.putObject(uploadOptions);
		return `https://${this.bucket}.tcb.qcloud.la/${fileName}`;
	}

	/**
	 * 上传 Buffer 到当前对象存储桶，供服务端生成的缓存文件复用。
	 */
	async uploadBufferToCOS(
		key: string,
		buffer: Buffer,
		contentType = 'application/octet-stream',
		openid = '',
	): Promise<string> {
		const safeKey = this.normalizeCosKey(key);
		const cloudPath = `/${safeKey}`;
		const metaFileId = await this.getFileMetaData(cloudPath, openid);
		const uploadOptions: any = {
			Bucket: this.bucket,
			Region: this.region,
			Key: safeKey,
			Body: buffer,
			ContentType: contentType,
			ContentLength: buffer.length,
			StorageClass: 'STANDARD',
		};
		if (metaFileId) {
			uploadOptions.Headers = { 'x-cos-meta-fileid': metaFileId };
		}
		await this.cos.putObject(uploadOptions);
		return this.getCosPublicUrl(safeKey);
	}

	async cosObjectExists(key: string): Promise<boolean> {
		const safeKey = this.normalizeCosKey(key);
		try {
			await this.cos.headObject({
				Bucket: this.bucket,
				Region: this.region,
				Key: safeKey,
			});
			return true;
		} catch {
			return false;
		}
	}

	async readCosObjectBuffer(key: string): Promise<Buffer | null> {
		const safeKey = this.normalizeCosKey(key);
		try {
			const result = await this.cos.getObject({
				Bucket: this.bucket,
				Region: this.region,
				Key: safeKey,
			});
			const body = (result as any)?.Body;
			if (Buffer.isBuffer(body)) return body;
			if (body instanceof Uint8Array) return Buffer.from(body);
			if (typeof body === 'string') return Buffer.from(body);
			return null;
		} catch {
			return null;
		}
	}

	async readCosUrlBuffer(url: string): Promise<Buffer | null> {
		if (!this.isAllowedProxyUrl(url)) {
			return null;
		}
		const key = this.extractKeyFromUrl(url);
		if (!key) {
			return null;
		}
		return this.readCosObjectBuffer(key);
	}

	getCosPublicUrl(key: string): string {
		return `https://${this.bucket}.tcb.qcloud.la/${this.normalizeCosKey(key)}`;
	}

	private normalizeCosKey(key: string): string {
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
	async saveCourseFileChunk(
		uploadId: string,
		chunkIndex: number,
		totalChunks: number,
		buffer: Buffer,
	): Promise<void> {
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
	 * 合并课程文件分片并保存（本地或 COS），返回最终 fileUrl
	 */
	async mergeCourseFileChunks(
		uploadId: string,
		totalChunks: number,
		fileName: string,
	): Promise<string> {
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
	 * 从 URL 中提取 COS Key
	 */
	private extractKeyFromUrl(url: string): string | null {
		try {
			// URL 格式：https://{bucket}.cos.{region}.myqcloud.com/{key}
			// 或：https://{bucket}.tcb.qcloud.la/{key}
			const match = url.match(/(?:\.myqcloud\.com|\.tcb\.qcloud\.la)\/(.+)$/);
			return match ? match[1] : null;
		} catch {
			return null;
		}
	}

	/**
	 * 判断 URL 是否为本项目 TCB 域名（仅允许代理自家存储，防止滥用）
	 */
	isAllowedProxyUrl(url: string): boolean {
		if (!url || typeof url !== 'string') return false;
		const normalized = url.trim();
		if (!normalized.startsWith('https://')) return false;
		// 只允许当前配置的 bucket 对应的 tcb 域名
		const allowedHost = `${this.bucket}.tcb.qcloud.la`;
		try {
			const u = new URL(normalized);
			return u.hostname === allowedHost;
		} catch {
			return false;
		}
	}

	/**
	 * 代理拉取 TCB 图片并返回 buffer 与 contentType（用于解决管理端跨域无法直接显示 TCB 图片）
	 */
	async proxyImage(url: string): Promise<{ data: Buffer; contentType: string }> {
		if (!this.isAllowedProxyUrl(url)) {
			throw new BadRequestException('仅允许代理本项目的 TCB 图片地址');
		}
		const res = await axios.get(url, {
			responseType: 'arraybuffer',
			timeout: 15000,
			validateStatus: () => true,
		});
		if (res.status !== 200) {
			throw new BadRequestException(`拉取图片失败: ${res.status}`);
		}
		const contentType = res.headers['content-type'] || 'image/png';
		return { data: Buffer.from(res.data), contentType };
	}

	private isImageContentType(contentType: string): boolean {
		return /^image\/(jpeg|jpg|png|gif|webp)/i.test(String(contentType || '').split(';')[0].trim());
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
