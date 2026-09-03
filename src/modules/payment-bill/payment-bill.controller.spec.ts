import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminRole } from "../../database/entities/sys-user.entity";
import { PaymentBillController } from "./payment-bill.controller";
import { PaymentBillService } from "./payment-bill.service";

describe("payment bill administrator boundary", () => {
  let app: INestApplication;
  const service = {
    list: jest.fn(),
    fetch: jest.fn(),
    preview: jest.fn(),
    download: jest.fn(),
    audit: jest.fn(),
  };
  const admin = { type: "admin", adminId: 7, role: AdminRole.SUPER_ADMIN };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentBillController],
      providers: [{ provide: PaymentBillService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers["x-test-identity"])
            throw new UnauthorizedException();
          req.user = JSON.parse(req.headers["x-test-identity"]);
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.resetAllMocks();
    service.list.mockResolvedValue({ list: [], total: 0 });
    service.fetch.mockResolvedValue({ id: 1, status: "pending" });
    service.preview.mockResolvedValue({ rows: [], total: 0 });
    service.download.mockResolvedValue({
      buffer: Buffer.from("bill"),
      filename: "payment-bill-xpay-2026-08-31.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    service.audit.mockResolvedValue(undefined);
  });
  it.each(["", "/1/preview", "/1/download"])(
    "requires authentication for GET %s",
    async (path) => {
      await request(app.getHttpServer())
        .get(`/admin/payment-bills${path}`)
        .expect(401);
      expect(service.list).not.toHaveBeenCalled();
      expect(service.download).not.toHaveBeenCalled();
    },
  );
  it.each([
    { type: "app", userId: 7, role: AdminRole.SUPER_ADMIN },
    { type: "admin", adminId: 7, role: AdminRole.CONTENT_ADMIN },
    { type: "admin", role: AdminRole.SUPER_ADMIN },
  ])(
    "rejects wrong identity %j even when a role name matches",
    async (identity) => {
      await request(app.getHttpServer())
        .get("/admin/payment-bills/1/download")
        .set("x-test-identity", JSON.stringify(identity))
        .expect(403);
      expect(service.download).not.toHaveBeenCalled();
    },
  );
  it("protects mutation endpoint with the same administrator boundary", async () => {
    await request(app.getHttpServer())
      .post("/admin/payment-bills/fetch")
      .send({ channel: "wechat", billDate: "2026-09-01" })
      .expect(401);
    await request(app.getHttpServer())
      .post("/admin/payment-bills/fetch")
      .set(
        "x-test-identity",
        JSON.stringify({ type: "app", userId: 1, role: AdminRole.SUPER_ADMIN }),
      )
      .send({ channel: "wechat", billDate: "2026-09-01" })
      .expect(403);
    expect(service.fetch).not.toHaveBeenCalled();
  });
  it("validates channel/date and bounds before calling service", async () => {
    await request(app.getHttpServer())
      .post("/admin/payment-bills/fetch")
      .set("x-test-identity", JSON.stringify(admin))
      .send({ channel: "evil", billDate: "bad", signedUrl: "https://evil" })
      .expect(400);
    await request(app.getHttpServer())
      .get("/admin/payment-bills?pageSize=101")
      .set("x-test-identity", JSON.stringify(admin))
      .expect(400);
    expect(service.fetch).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
  });
  it("sets no-store and audits preview without row contents", async () => {
    await request(app.getHttpServer())
      .get("/admin/payment-bills/1/preview?page=2&pageSize=10")
      .set("x-test-identity", JSON.stringify(admin))
      .expect(200)
      .expect("Cache-Control", "no-store");
    expect(service.preview).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
    expect(service.audit).toHaveBeenCalledWith(7, "preview", 1);
  });
  it("streams private attachment only after audit persistence and forbids unknown formats", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin/payment-bills/1/download?format=original")
      .set("x-test-identity", JSON.stringify(admin))
      .expect(200)
      .expect("Cache-Control", "no-store");
    expect(response.headers["content-disposition"]).toContain(
      "payment-bill-xpay-2026-08-31.xlsx",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(service.audit).toHaveBeenCalledWith(7, "download", 1, "original");
    await request(app.getHttpServer())
      .get("/admin/payment-bills/1/download?format=html")
      .set("x-test-identity", JSON.stringify(admin))
      .expect(400);
    expect(service.download).toHaveBeenCalledTimes(1);
  });
  it("fails closed when a sensitive access cannot be audited", async () => {
    service.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    const response = await request(app.getHttpServer())
      .get("/admin/payment-bills/1/download")
      .set("x-test-identity", JSON.stringify(admin))
      .expect(500);
    expect(response.headers["content-disposition"]).toBeUndefined();
  });
});
