#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const OSS = require("ali-oss");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const root = path.resolve(__dirname, "..");
loadEnvFile(path.join(root, ".env.remote"));
loadEnvFile(path.join(root, ".env"));

const required = ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_BUCKET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`缺少 OSS 配置: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new OSS({
  region: process.env.OSS_REGION || "oss-cn-shanghai",
  bucket: process.env.OSS_BUCKET,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  ...(process.env.OSS_ENDPOINT ? { endpoint: process.env.OSS_ENDPOINT } : {}),
  secure: true,
});

const ruleId = "practice-hub-course-staging-cleanup";
const stagingDays = Math.max(
  1,
  Number(process.env.OSS_STAGING_EXPIRE_DAYS || 2),
);
const rule = {
  id: ruleId,
  prefix: "course-files/staging/",
  status: "Enabled",
  expiration: { days: stagingDays },
  abortMultipartUpload: { days: 1 },
};

async function getRules() {
  try {
    const result = await client.getBucketLifecycle(process.env.OSS_BUCKET);
    return Array.isArray(result.rules) ? result.rules : [];
  } catch (error) {
    if (error?.code === "NoSuchLifecycle") return [];
    throw error;
  }
}

async function main() {
  const existingRules = await getRules();
  const nextRules = [
    ...existingRules.filter((item) => item.id !== ruleId),
    rule,
  ];
  console.log(`Bucket: ${process.env.OSS_BUCKET}`);
  console.log(`现有生命周期规则: ${existingRules.length}`);
  console.log(
    `将配置临时课程文件 ${stagingDays} 天后删除，并清理 1 天前未完成的分片上传。`,
  );
  if (!process.argv.includes("--apply")) {
    console.log(
      "当前为预览模式；确认后执行 npm run storage:configure-lifecycle -- --apply",
    );
    return;
  }
  await client.putBucketLifecycle(process.env.OSS_BUCKET, nextRules);
  console.log(
    `✓ 生命周期规则已更新，保留并重新提交了其余 ${existingRules.filter((item) => item.id !== ruleId).length} 条规则。`,
  );
}

main().catch((error) => {
  console.error(`配置 OSS 生命周期失败: ${error?.message || error}`);
  process.exit(1);
});
