import { normalizeUploadedFileName } from "./file-name-encoding";

describe("normalizeUploadedFileName", () => {
  it("restores a UTF-8 Chinese file name decoded as Latin-1", () => {
    const fileName = "非师范教育类毕业申请认定（42题）.pdf";
    const mojibake = Buffer.from(fileName, "utf8").toString("latin1");

    expect(normalizeUploadedFileName(mojibake)).toBe(fileName);
  });

  it("restores Chinese mojibake even when its bytes contain no C1 control character", () => {
    const fileName = "鿿.pdf";
    const mojibake = Buffer.from(fileName, "utf8").toString("latin1");

    expect(/[\u0080-\u009f]/u.test(mojibake)).toBe(false);
    expect(normalizeUploadedFileName(mojibake)).toBe(fileName);
  });

  it.each(["course-material.pdf", "résumé.pdf", "正常中文文件名.pdf", ""])(
    "preserves a valid file name: %s",
    (fileName) => {
      expect(normalizeUploadedFileName(fileName)).toBe(fileName);
    },
  );

  it("preserves malformed Latin-1 when it cannot become valid Chinese UTF-8", () => {
    const malformed = `invalid-${String.fromCharCode(0x81)}.pdf`;

    expect(normalizeUploadedFileName(malformed)).toBe(malformed);
  });
});
