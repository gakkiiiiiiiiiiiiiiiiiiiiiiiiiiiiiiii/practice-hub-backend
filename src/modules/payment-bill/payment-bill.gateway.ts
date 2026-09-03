import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { createHash, createHmac } from "crypto";
import { PaymentBillChannel } from "../../database/entities/payment-bill.entity";
import { XpayService } from "../order/xpay.service";
import { MAX_BILL_BYTES } from "./payment-bill.parser";

export type BillResult =
  | { status: "ready"; original: Buffer }
  | { status: "pending" | "empty" };

@Injectable()
export class PaymentBillGateway {
  constructor(
    private readonly config: ConfigService,
    private readonly xpay: XpayService,
  ) {}

  accountKey(channel: PaymentBillChannel): string {
    const appid =
      this.config.get<string>("WECHAT_APPID") ||
      this.config.get<string>("AppID");
    const merchant =
      this.config.get<string>("WECHAT_PAY_MCH_ID") ||
      this.config.get<string>("MCH_ID");
    const env = this.config.get<string>("WECHAT_VIRTUAL_PAY_ENV") || "0";
    if (!appid || (channel === "wechat" && !merchant))
      throw new BadRequestException("支付账单账户配置缺失");
    return createHash("sha256")
      .update(`${channel}:${appid}:${channel === "wechat" ? merchant : env}`)
      .digest("hex");
  }

  async fetch(channel: PaymentBillChannel, date: string): Promise<BillResult> {
    return channel === "wechat" ? this.fetchWechat(date) : this.fetchXpay(date);
  }

  private async fetchWechat(date: string): Promise<BillResult> {
    const subMchId =
      this.config.get<string>("WECHAT_PAY_MCH_ID") ||
      this.config.get<string>("MCH_ID");
    const response = await axios.post(
      "http://api.weixin.qq.com/_/pay/downloadbill",
      {
        bill_date: date.replace(/-/g, ""),
        bill_type: "ALL",
        sub_mch_id: subMchId,
      },
      {
        timeout: 20000,
        maxRedirects: 0,
        maxContentLength: MAX_BILL_BYTES + 65536,
        maxBodyLength: 65536,
      },
    );
    const envelope = response.data;
    if (
      !envelope ||
      typeof envelope !== "object" ||
      Number(envelope.errcode) !== 0
    ) {
      throw new BadRequestException(
        "云托管微信账单接口调用失败，请检查云托管运行环境与商户授权",
      );
    }
    const payload = envelope.respdata;
    if (
      payload &&
      typeof payload === "object" &&
      payload.return_code === "FAIL" &&
      String(payload.error_code) === "20002" &&
      payload.return_msg === "No Bill Exist"
    )
      return { status: "empty" };
    if (
      typeof payload !== "string" ||
      !payload.trim() ||
      /^\s*[<{]/.test(payload)
    ) {
      throw new BadRequestException(
        "微信账单返回格式未识别，未将其标记为无账单",
      );
    }
    const original = Buffer.from(payload, "utf8");
    if (original.length > MAX_BILL_BYTES)
      throw new BadRequestException("账单超过 10 MiB，请使用微信商户平台下载");
    return { status: "ready", original };
  }

  private async fetchXpay(date: string): Promise<BillResult> {
    const env = Number(
      this.config.get<string>("WECHAT_VIRTUAL_PAY_ENV") || "0",
    );
    const appKey =
      (env === 1
        ? this.config.get<string>("WECHAT_VIRTUAL_PAY_SANDBOX_APPKEY") ||
          this.config.get<string>("SandboxAppKey")
        : this.config.get<string>("WECHAT_VIRTUAL_PAY_APPKEY") ||
          this.config.get<string>("ProdAppKey")) ||
      this.config.get<string>("AppKey") ||
      this.config.get<string>("APP_KEY");
    if (!appKey || ![0, 1].includes(env))
      throw new BadRequestException("虚拟支付账单密钥或环境配置缺失");
    const token = await this.xpay.getWechatAccessTokenForBill();
    const endpoint = "/xpay/download_bill";
    const ds = Number(date.replace(/-/g, ""));
    const body = JSON.stringify({ begin_ds: ds, end_ds: ds, env });
    const response = await axios.post(
      `https://api.weixin.qq.com${endpoint}`,
      body,
      {
        params: {
          access_token: token,
          pay_sig: createHmac("sha256", appKey)
            .update(`${endpoint}&${body}`)
            .digest("hex"),
        },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
        maxRedirects: 0,
        maxContentLength: 65536,
      },
    );
    const data = response.data;
    if (Number(data?.errcode) === 268490011) return { status: "pending" };
    if (!data || typeof data !== "object" || Number(data.errcode) !== 0) {
      throw new BadRequestException(
        "虚拟支付账单申请失败，请检查日期、密钥和平台权限",
      );
    }
    if (typeof data.url !== "string" || !data.url)
      throw new BadRequestException(
        "虚拟支付账单下载地址格式未识别，未将其标记为无账单",
      );
    return { status: "ready", original: await this.download(data.url) };
  }

  async download(value: string): Promise<Buffer> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException("账单下载地址无效");
    }
    // Exact WeChat-owned hosts only; do not permit wildcard cloud buckets, IPs, userinfo or redirects.
    const allowedHosts = new Set([
      "api.weixin.qq.com",
      "api.mch.weixin.qq.com",
      "mmbizwxaintpcos-1258344707.cos.ap-shanghai.myqcloud.com",
    ]);
    if (
      url.protocol !== "https:" ||
      !allowedHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      url.hash
    )
      throw new BadRequestException(
        "账单下载域名尚未验证，请联系管理员核验官方域名",
      );
    const response = await axios.get(url.toString(), {
      responseType: "arraybuffer",
      timeout: 20000,
      maxRedirects: 0,
      maxContentLength: MAX_BILL_BYTES,
      maxBodyLength: MAX_BILL_BYTES,
    });
    const bytes = Buffer.from(response.data);
    if (!bytes.length || bytes.length > MAX_BILL_BYTES)
      throw new BadRequestException("账单为空或超过 10 MiB 限制");
    const start = bytes.subarray(0, 128).toString("utf8").trimStart();
    if (/^(?:<!doctype|<html|<xml|\{\s*"errcode")/i.test(start))
      throw new BadRequestException("下载响应不是账单文件");
    return bytes;
  }
}
