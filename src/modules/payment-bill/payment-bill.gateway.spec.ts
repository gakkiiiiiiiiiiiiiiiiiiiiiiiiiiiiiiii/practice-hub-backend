import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { createHmac } from "crypto";
import { PaymentBillGateway } from "./payment-bill.gateway";
import { XpayService } from "../order/xpay.service";

jest.mock("axios");
const http = axios as jest.Mocked<typeof axios>;
function config(extra: Record<string, string> = {}) {
  const values = {
    WECHAT_APPID: "test-app",
    WECHAT_PAY_MCH_ID: "test-merchant",
    WECHAT_VIRTUAL_PAY_APPKEY: "test-only-key",
    WECHAT_SECRET: "test-only-secret",
    ...extra,
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

describe("bounded bill gateway", () => {
  let token: jest.Mock;
  let gateway: PaymentBillGateway;
  beforeEach(() => {
    jest.resetAllMocks();
    token = jest.fn().mockResolvedValue("test-token");
    gateway = new PaymentBillGateway(config(), {
      getWechatAccessTokenForBill: token,
    } as unknown as XpayService);
  });
  it("signs numeric date Xpay request, handles generation status without polling or offer ID", async () => {
    http.post.mockResolvedValue({
      data: { errcode: 268490011, errmsg: "generation contains-private-rid" },
    });
    expect(await gateway.fetch("xpay", "2026-08-31")).toEqual({
      status: "pending",
    });
    const body = JSON.stringify({
      begin_ds: 20260831,
      end_ds: 20260831,
      env: 0,
    });
    expect(http.post).toHaveBeenCalledWith(
      "https://api.weixin.qq.com/xpay/download_bill",
      body,
      expect.objectContaining({
        params: {
          access_token: "test-token",
          pay_sig: createHmac("sha256", "test-only-key")
            .update(`/xpay/download_bill&${body}`)
            .digest("hex"),
        },
        timeout: 20000,
        maxRedirects: 0,
      }),
    );
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.get).not.toHaveBeenCalled();
  });
  it("fetches exact verified Xpay host once", async () => {
    http.post.mockResolvedValue({
      data: {
        errcode: 0,
        url: "https://mmbizwxaintpcos-1258344707.cos.ap-shanghai.myqcloud.com/test.xlsx?sig=secret",
      },
    });
    http.get.mockResolvedValue({ data: Buffer.from("official-file") });
    expect(await gateway.fetch("xpay", "2026-08-31")).toEqual({
      status: "ready",
      original: Buffer.from("official-file"),
    });
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][1]).toMatchObject({
      timeout: 20000,
      maxRedirects: 0,
      responseType: "arraybuffer",
    });
  });
  it.each([
    "http://api.weixin.qq.com/file",
    "https://127.0.0.1/file",
    "https://api.weixin.qq.com.evil.test/file",
    "https://evil.cos.ap-shanghai.myqcloud.com/file",
    "https://user:pass@api.weixin.qq.com/file",
    "https://api.weixin.qq.com:8443/file",
    "https://api.weixin.qq.com/file#fragment",
  ])("rejects untrusted download URL %s", async (url) => {
    await expect(gateway.download(url)).rejects.toThrow();
    expect(http.get).not.toHaveBeenCalled();
  });
  it("does not classify missing URL or provider error as a valid empty bill", async () => {
    http.post
      .mockResolvedValueOnce({ data: { errcode: 0, total_cnt: 0 } })
      .mockResolvedValueOnce({
        data: { errcode: 40001, errmsg: "private-provider-message" },
      });
    await expect(gateway.fetch("xpay", "2026-08-31")).rejects.toThrow(
      "地址格式未识别",
    );
    await expect(gateway.fetch("xpay", "2026-08-31")).rejects.toThrow(
      "虚拟支付账单申请失败",
    );
  });
  it("only recognizes explicit WeChat no-bill response", async () => {
    http.post
      .mockResolvedValueOnce({
        data: {
          errcode: 0,
          respdata: {
            return_code: "FAIL",
            return_msg: "No Bill Exist",
            error_code: "20002",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          errcode: 0,
          respdata: { return_code: "FAIL", return_msg: "System error" },
        },
      });
    expect(await gateway.fetch("wechat", "2026-09-01")).toEqual({
      status: "empty",
    });
    await expect(gateway.fetch("wechat", "2026-09-01")).rejects.toThrow(
      "返回格式未识别",
    );
  });
  it("single-attempt token getter shares cache, does not need offer ID, and redacts failures", async () => {
    const xpay = new XpayService(config());
    http.post.mockResolvedValueOnce({
      data: { access_token: "test-token", expires_in: 7200 },
    });
    expect(await xpay.getWechatAccessTokenForBill()).toBe("test-token");
    expect(await xpay.getWechatAccessTokenForBill()).toBe("test-token");
    expect(http.post).toHaveBeenCalledTimes(1);
    const uncached = new XpayService(config());
    http.post.mockRejectedValueOnce(new Error("secret URL/token"));
    await expect(uncached.getWechatAccessTokenForBill()).rejects.toThrow(
      "访问凭证获取失败",
    );
    expect(http.post).toHaveBeenCalledTimes(2);
  });
});
