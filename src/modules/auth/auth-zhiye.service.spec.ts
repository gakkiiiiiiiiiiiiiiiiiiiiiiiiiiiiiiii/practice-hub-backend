import { UnauthorizedException } from "@nestjs/common";
import axios from "axios";
import { AppUserRole } from "../../database/entities/app-user.entity";
import { AuthService } from "./auth.service";

describe("AuthService 知页独立小程序登录", () => {
  afterEach(() => jest.restoreAllMocks());

  const createService = (config: Record<string, string>) => {
    const appUserRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ id: 9, role: AppUserRole.USER, ...value })),
      save: jest.fn(async (value) => value),
    };
    const jwtService = { sign: jest.fn(() => "zhiye-token") };
    const service = new AuthService(
      appUserRepository as any,
      null,
      jwtService as any,
      { get: jest.fn((key: string) => config[key]) } as any,
      { bindDistributionRelation: jest.fn() } as any,
      null,
      null,
      { bindReferralOnAuth: jest.fn() } as any,
    );
    return { service, appUserRepository, jwtService };
  };

  it("does not fall back to the practice-hub AppSecret", async () => {
    const { service } = createService({
      WECHAT_APPID: "wx0000000000000000",
      WECHAT_SECRET: "legacy-secret",
      ZHIYE_WECHAT_APPID: "wx1111111111111111",
    });
    const get = jest.spyOn(axios, "get");

    await expect(
      service.appLogin("code", undefined, undefined, undefined, "zhiye"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).not.toHaveBeenCalled();
  });

  it("namespaces the OpenID by the independent AppID and verifies HTTPS certificates", async () => {
    const { service, appUserRepository, jwtService } = createService({
      ZHIYE_WECHAT_APPID: "wx1111111111111111",
      ZHIYE_WECHAT_SECRET: "zhiye-secret",
    });
    const get = jest.spyOn(axios, "get").mockResolvedValue({
      data: { openid: "raw-openid", session_key: "session-key" },
    });

    await expect(
      service.appLogin(
        "one-time-code",
        undefined,
        undefined,
        undefined,
        "zhiye",
      ),
    ).resolves.toMatchObject({ token: "zhiye-token" });
    expect(get).toHaveBeenCalledWith(
      "https://api.weixin.qq.com/sns/jscode2session",
      expect.objectContaining({
        params: expect.objectContaining({
          appid: "wx1111111111111111",
          secret: "zhiye-secret",
          js_code: "one-time-code",
        }),
        timeout: 15000,
      }),
    );
    const requestOptions = get.mock.calls[0][1] as any;
    expect(requestOptions.httpsAgent.options.rejectUnauthorized).toBe(true);
    expect(appUserRepository.findOne).toHaveBeenCalledWith({
      where: { openid: "zhiye:wx1111111111111111:raw-openid" },
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        openid: "zhiye:wx1111111111111111:raw-openid",
        type: "app",
      }),
    );
  });
});
