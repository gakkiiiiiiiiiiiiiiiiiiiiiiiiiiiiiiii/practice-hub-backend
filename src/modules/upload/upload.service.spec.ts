import { ConfigService } from "@nestjs/config";
import { UploadService } from "./upload.service";

describe("UploadService image URL normalization", () => {
  const bucket = "7072-prod-d1gguk4ie589126ba-1424780330";
  let service: UploadService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === "COS_BUCKET") return bucket;
        if (key === "COS_REGION") return "ap-shanghai";
        if (key === "UPLOAD_DIR")
          return "/tmp/practice-hub-upload-service-test";
        return fallback;
      }),
    } as unknown as ConfigService;
    service = new UploadService(config);
  });

  it("converts a WeChat cloud file ID to its TCB HTTPS URL", () => {
    const fileId = `cloud://prod-d1gguk4ie589126ba.${bucket}/feedback/example.jpg`;

    expect(service.getPublicImageUrl(fileId)).toBe(
      `https://${bucket}.tcb.qcloud.la/feedback/example.jpg`,
    );
  });

  it("does not rewrite a cloud file ID from another bucket", () => {
    const fileId = "cloud://another-env.another-bucket/feedback/example.jpg";

    expect(service.getPublicImageUrl(fileId)).toBe(fileId);
  });
});
