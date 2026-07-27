const CJK_CHARACTER = /[\u3400-\u9fff\uf900-\ufaff]/u;

/**
 * 修复 multipart 解析器把 UTF-8 文件名字节按 Latin-1 解码后产生的乱码。
 *
 * 只转换同时满足以下条件的值：
 * 1. 原值全部落在 Latin-1 单字节范围；
 * 2. 按 Latin-1 还原字节再解码为 UTF-8 后，不含替换字符；
 * 3. 解码结果包含中日韩文字。
 *
 * 这样可以避免误伤 ASCII、正常 Unicode，以及 résumé.pdf 这类合法 Latin-1 文件名。
 */
export function normalizeUploadedFileName(value?: string | null): string {
  const original = String(value || "");
  if (!original || /[^\u0000-\u00ff]/u.test(original)) {
    return original;
  }

  const decoded = Buffer.from(original, "latin1").toString("utf8");
  if (!decoded || decoded.includes("\ufffd") || !CJK_CHARACTER.test(decoded)) {
    return original;
  }

  return decoded;
}
