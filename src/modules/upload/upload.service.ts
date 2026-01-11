import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as COS from 'cos-nodejs-sdk-v5';
import axios from 'axios';
import * as https from 'https';
import * as fs from 'fs';
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
	private cos: COS;
	private bucket: string;
	private region: string;
	private tempAuth: TempAuth | null = null;
	private authExpireTime: number = 0;
	private uploadDir: string;
	private baseUrl: string;

	constructor(private configService: ConfigService) {
		this.bucket = this.configService.get<string>('COS_BUCKET', '7072-prod-6g7tpqs40c5a758b-1392943725');
		this.region = this.configService.get<string>('COS_REGION', 'ap-shanghai');

		// 本地存储配置
		this.uploadDir = path.join(process.cwd(), 'uploads');

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
		if (!fs.existsSync(this.uploadDir)) {
			fs.mkdirSync(this.uploadDir, { recursive: true });
			console.log(`[本地存储] 创建上传目录: ${this.uploadDir}`);
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
	 * 保存文件到本地
	 * @param file 文件对象
	 * @param folder 存储文件夹
	 * @returns 文件相对路径
	 */
	private async saveFileToLocal(file: Express.Multer.File, folder: string = 'images'): Promise<string> {
		// 生成唯一文件名
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const ext = this.getFileExtension(file.originalname);
		const fileName = `${timestamp}-${randomStr}${ext}`;

		// 创建文件夹目录
		const folderPath = path.join(this.uploadDir, folder);
		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath, { recursive: true });
		}

		// 保存文件
		const filePath = path.join(folderPath, fileName);
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

		// 验证文件大小（限制 5MB）
		const maxSize = 5 * 1024 * 1024; // 5MB
		if (file.size > maxSize) {
			throw new BadRequestException('文件大小不能超过 5MB');
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
		// 生成唯一文件名
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const ext = this.getFileExtension(file.originalname);
		const fileName = `${folder}/${timestamp}-${randomStr}${ext}`;
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
			if (result.Location) {
				imageUrl = result.Location.startsWith('http') ? result.Location : `https://${result.Location}`;
			} else {
				// 微信云托管环境使用 tcb 域名
				imageUrl = `https://${this.bucket}.tcb.qcloud.la/${fileName}`;
			}

			console.log(`[COS上传] 成功: ${imageUrl}, 元数据: ${metaFileId || '未设置'}`);
			return imageUrl;
		} catch (error: any) {
			console.error('[COS上传] 失败:', error);
			throw new BadRequestException(`图片上传失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 删除文件（根据 URL 判断是本地还是 COS）
	 * @param fileUrl 文件 URL
	 */
	async deleteImage(fileUrl: string): Promise<void> {
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
}
