import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';
import axios from 'axios';

export type XpayConfig = {
  env: number;
  appKey: string;
  offerId: string;
};

@Injectable()
export class XpayService {
  private readonly logger = new Logger(XpayService.name);
  private wechatAccessTokenCache: { token: string; expireAt: number } | null = null;
  private wechatTlsCompatWarned = false;

  constructor(private readonly configService: ConfigService) {}

  getVirtualPayConfig(): XpayConfig {
    const env = Number(this.configService.get<string>('WECHAT_VIRTUAL_PAY_ENV') ?? 0);
    const appKey =
      (env === 1
        ? this.configService.get<string>('WECHAT_VIRTUAL_PAY_SANDBOX_APPKEY') ||
          this.configService.get<string>('SandboxAppKey')
        : this.configService.get<string>('WECHAT_VIRTUAL_PAY_APPKEY') ||
          this.configService.get<string>('ProdAppKey')) ||
      this.configService.get<string>('AppKey') ||
      this.configService.get<string>('APP_KEY');
    const offerId =
      this.configService.get<string>('WECHAT_VIRTUAL_PAY_OFFER_ID') ||
      this.configService.get<string>('OfferID') ||
      this.configService.get<string>('OFFER_ID');

    if (!appKey || !offerId) {
      throw new BadRequestException('微信虚拟支付配置缺失，请检查 AppKey 和 WECHAT_VIRTUAL_PAY_OFFER_ID');
    }

    return {
      env: Number.isFinite(env) ? env : 0,
      appKey,
      offerId,
    };
  }

  /** 调用微信 xpay 接口（query_user_balance / currency_pay / query_order 等） */
  async callXpayApi(
    endpoint: string,
    payload: Record<string, any>,
    options?: { sessionKey?: string | null; accessToken?: string | null },
  ): Promise<Record<string, any>> {
    const config = this.getVirtualPayConfig();
    const bodyPayload = { ...payload, env: Number(payload.env ?? config.env) };
    const body = JSON.stringify(bodyPayload);
    const accessToken =
      options?.accessToken ??
      (await this.getWechatAccessTokenWithFallback()) ??
      (await this.getWechatAccessTokenWithFallback(true));
    if (!accessToken) {
      throw new BadRequestException('微信服务繁忙，暂时无法连接，请稍后重试');
    }
    const paySig = this.createHmacSha256(config.appKey, `${endpoint}&${body}`);
    const params: Record<string, string> = {
      access_token: accessToken,
      pay_sig: paySig,
    };
    if (options?.sessionKey) {
      params.signature = this.createHmacSha256(options.sessionKey, body);
    }

    const urls = this.getWechatApiUrls(endpoint);
    let lastError: unknown;
    for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
      try {
        const response = await this.requestWechatPublicApi(urls[urlIndex], body, params);
        return response.data || {};
      } catch (error) {
        lastError = error;
        if (urlIndex < urls.length - 1 && this.isTransientWechatApiError(error)) {
          this.logger.warn(`xpay ${endpoint} 调用失败，尝试备用线路: ${this.getErrorMessage(error)}`);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  isXpayDuplicateSuccess(errcode: number) {
    return Number(errcode) === 268490004;
  }

  private async getWechatAccessTokenWithFallback(forceRefresh = false) {
    try {
      return await this.getWechatAccessToken(forceRefresh);
    } catch (error) {
      if (this.wechatAccessTokenCache?.token) {
        this.logger.warn(`获取微信 access_token 失败，使用内存缓存 token 兜底: ${this.getErrorMessage(error)}`);
        return this.wechatAccessTokenCache.token;
      }
      if (this.isTransientWechatApiError(error)) {
        this.logger.warn(`获取微信 access_token 失败: ${this.getErrorMessage(error)}`);
        return null;
      }
      throw error;
    }
  }

  private async getWechatAccessToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.wechatAccessTokenCache && this.wechatAccessTokenCache.expireAt > now + 60_000) {
      return this.wechatAccessTokenCache.token;
    }
    const appid = this.configService.get<string>('WECHAT_APPID') || this.configService.get<string>('AppID');
    const secret =
      this.configService.get<string>('WECHAT_SECRET') ||
      this.configService.get<string>('AppSecret') ||
      this.configService.get<string>('WECHAT_APPSECRET');
    if (!appid || !secret) {
      throw new BadRequestException('微信配置缺失：请检查 WECHAT_APPID 或 WECHAT_SECRET');
    }

    const maxAttempts = Math.max(1, Number(this.configService.get<string>('WECHAT_ACCESS_TOKEN_RETRY') || 5));
    const tokenUrls = this.getWechatApiUrls('/cgi-bin/stable_token');
    const tokenBody = JSON.stringify({
      grant_type: 'client_credential',
      appid,
      secret,
      force_refresh: !!forceRefresh,
    });
    let lastError: unknown;
    for (const tokenUrl of tokenUrls) {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await this.requestWechatPublicApi(tokenUrl, tokenBody, {});
          const data = response.data || {};
          if (data.errcode || !data.access_token) {
            throw new BadRequestException(data.errmsg || `获取微信 stable access_token 失败: ${data.errcode || 'unknown'}`);
          }
          this.wechatAccessTokenCache = {
            token: data.access_token,
            expireAt: now + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000,
          };
          return data.access_token;
        } catch (error) {
          lastError = error;
          if (!this.isTransientWechatApiError(error) || attempt >= maxAttempts) {
            break;
          }
          const delayMs = Math.min(8000, 800 * attempt);
          this.logger.warn(
            `获取微信 access_token 失败，准备重试 (${attempt}/${maxAttempts}): ${this.getErrorMessage(error)}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      if (lastError && !this.isTransientWechatApiError(lastError)) {
        throw lastError;
      }
      if (tokenUrl !== tokenUrls[tokenUrls.length - 1]) {
        this.logger.warn(`获取微信 access_token 失败，尝试备用线路: ${this.getErrorMessage(lastError)}`);
      }
    }

    try {
      this.logger.warn('stable_token 不可用，尝试 cgi-bin/token 兜底');
      return await this.fetchClassicAccessToken(appid, secret);
    } catch (classicError) {
      lastError = classicError;
    }

    throw lastError;
  }

  private async fetchClassicAccessToken(appid: string, secret: string) {
    const now = Date.now();
    const urls = this.getWechatApiUrls('/cgi-bin/token');
    let lastError: unknown;
    for (const url of urls) {
      try {
        const response = await this.requestWechatPublicApi(url, null, {
          grant_type: 'client_credential',
          appid,
          secret,
        });
        const data = response.data || {};
        if (data.errcode || !data.access_token) {
          throw new BadRequestException(data.errmsg || `获取微信 access_token 失败: ${data.errcode || 'unknown'}`);
        }
        this.wechatAccessTokenCache = {
          token: data.access_token,
          expireAt: now + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000,
        };
        return data.access_token;
      } catch (error) {
        lastError = error;
        if (url !== urls[urls.length - 1] && this.isTransientWechatApiError(error)) {
          this.logger.warn(`cgi-bin/token 调用失败，尝试备用线路: ${this.getErrorMessage(error)}`);
          continue;
        }
      }
    }
    throw lastError;
  }

  private isWeChatCloudRun() {
    return !!(
      process.env.WX_CLOUD_RUN_ENV === 'true' ||
      process.env.WX_CLOUD_ENV ||
      process.env.WX_CLOUDBASE_ENV ||
      process.env.CBR_ENV_ID ||
      this.configService.get<string>('WECHAT_PAY_CLOUDRUN_ENV_ID')
    );
  }

  private getWechatApiUrls(pathname: string) {
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    if (this.isWeChatCloudRun()) {
      return [`http://api.weixin.qq.com${normalizedPath}`, `https://api.weixin.qq.com${normalizedPath}`];
    }
    return [`https://api.weixin.qq.com${normalizedPath}`];
  }

  private getErrorMessage(error: any) {
    return String(error?.message || error?.response?.message || error || '');
  }

  private isTransientWechatApiError(error: any) {
    const status = Number(error?.response?.status || 0);
    const code = error?.code || error?.errno;
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      status === 502 ||
      status === 503 ||
      status === 504 ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('bad gateway') ||
      message.includes('econnreset') ||
      message.includes('timeout')
    );
  }

  private async requestWechatPublicApi(url: string, body: string | null, params: Record<string, any>) {
    try {
      return body === null
        ? await axios.get(url, { params, timeout: 20000 })
        : await axios.post(url, body, {
            params,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 30000,
          });
    } catch (error) {
      if (!this.isTlsCertificateError(error)) {
        throw error;
      }
      if (!this.wechatTlsCompatWarned) {
        this.logger.warn(`微信公网接口 TLS 证书校验失败，使用兼容模式重试: ${error?.message || error}`);
        this.wechatTlsCompatWarned = true;
      }
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      return body === null
        ? axios.get(url, { params, timeout: 20000, httpsAgent })
        : axios.post(url, body, {
            params,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 30000,
            httpsAgent,
          });
    }
  }

  private isTlsCertificateError(error: any) {
    const message = String(error?.message || error?.code || '').toLowerCase();
    return (
      message.includes('self-signed certificate') ||
      message.includes('unable to verify') ||
      message.includes('certificate') ||
      error?.code === 'SELF_SIGNED_CERT_IN_CHAIN'
    );
  }

  private createHmacSha256(secret: string, data: string) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
}
