import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as COS from 'cos-nodejs-sdk-v5';
import axios from 'axios';

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

	constructor(private configService: ConfigService) {
		this.bucket = this.configService.get<string>('COS_BUCKET', '7072-prod-6g7tpqs40c5a758b-1392943725');
		this.region = this.configService.get<string>('COS_REGION', 'ap-shanghai');

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
	 * 获取文件元数据（必须，否则小程序端无法访问）
	 * @param cloudPath 云上文件路径
	 * @param openid 用户openid，管理端传空字符串
	 */
	private async getFileMetaData(cloudPath: string, openid: string = ''): Promise<string> {
		try {
			const response = await axios.post('https://api.weixin.qq.com/_/cos/metaid/encode', {
				openid: openid, // 管理端上传时传空字符串
				bucket: this.bucket,
				paths: [cloudPath],
			});

			const result: MetaDataResponse = response.data;

			if (result.errcode !== 0) {
				throw new Error(`获取文件元数据失败: ${result.errmsg}`);
			}

			if (!result.respdata?.x_cos_meta_field_strs?.[0]) {
				throw new Error('获取文件元数据失败：返回数据不完整');
			}

			return result.respdata.x_cos_meta_field_strs[0];
		} catch (error: any) {
			console.error('[COS元数据] 获取失败:', error.message);
			throw new Error(`获取文件元数据失败: ${error.message}`);
		}
	}

	/**
	 * 上传图片到 COS
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

		// 生成唯一文件名
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 15);
		const ext = this.getFileExtension(file.originalname);
		const fileName = `${folder}/${timestamp}-${randomStr}${ext}`;
		const cloudPath = `/${fileName}`;

		try {
			// 1. 获取文件元数据（必须，否则小程序端无法访问）
			const metaFileId = await this.getFileMetaData(cloudPath, openid);

			// 2. 上传到 COS，必须添加 x-cos-meta-fileid 元数据
			const result = await this.cos.putObject({
				Bucket: this.bucket,
				Region: this.region,
				Key: fileName,
				Body: file.buffer,
				ContentType: file.mimetype,
				StorageClass: 'STANDARD',
				Headers: {
					'x-cos-meta-fileid': metaFileId,
				},
			});

			if (result.statusCode !== 200) {
				throw new Error(`上传失败，状态码: ${result.statusCode}`);
			}

			// 构建图片 URL
			// 使用微信云托管控制台的访问路径格式：tcb.qcloud.la
			// 或者使用 COS 路径：https://{bucket}.cos.{region}.myqcloud.com/{key}
			// 注意：COS 路径默认私有，需要签名才能访问
			// 推荐使用微信云托管控制台的路径格式
			const imageUrl = `https://${this.bucket}.cos.${this.region}.myqcloud.com/${fileName}`;

			console.log(`[COS上传] 成功: ${imageUrl}, 元数据: ${metaFileId}`);
			return imageUrl;
		} catch (error: any) {
			console.error('[COS上传] 失败:', error);
			throw new BadRequestException(`图片上传失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 删除 COS 中的文件
	 * @param fileUrl 文件 URL
	 */
	async deleteImage(fileUrl: string): Promise<void> {
		try {
			// 从 URL 中提取 Key
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
		} catch (error: any) {
			console.error('[COS删除] 失败:', error);
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
			const match = url.match(/\.myqcloud\.com\/(.+)$/);
			return match ? match[1] : null;
		} catch {
			return null;
		}
	}
}
