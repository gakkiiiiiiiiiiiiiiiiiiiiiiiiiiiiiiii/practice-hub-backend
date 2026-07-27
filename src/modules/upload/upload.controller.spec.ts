import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";

describe("UploadController course file names", () => {
  it("normalizes a mojibake multipart file name before storing and returning it", async () => {
    const expectedFileName = "非师范教育类模拟卷（42题）.pdf";
    const file = {
      originalname: Buffer.from(expectedFileName, "utf8").toString("latin1"),
    } as Express.Multer.File;
    const uploadService = {
      uploadCourseFile: jest
        .fn()
        .mockResolvedValue("https://example.test/course.pdf"),
    } as unknown as jest.Mocked<UploadService>;
    const controller = new UploadController(uploadService);

    const response = await controller.uploadCourseFile(file);

    expect(file.originalname).toBe(expectedFileName);
    expect(uploadService.uploadCourseFile).toHaveBeenCalledWith(file, "");
    expect(response.data).toMatchObject({
      fileName: expectedFileName,
      fileType: "pdf",
    });
  });
});
