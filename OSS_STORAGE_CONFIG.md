# 阿里云 OSS 配置指南

项目的图片、课程文件、PDF 和预览缓存统一使用阿里云 OSS。永久 AccessKey 仅保存在后端环境变量中，浏览器大文件上传使用 15 分钟有效的签名 PUT URL。

## 环境变量

```dotenv
OSS_ACCESS_KEY_ID=RAM用户AccessKeyId
OSS_ACCESS_KEY_SECRET=RAM用户AccessKeySecret
OSS_BUCKET=practice-hub-prod-1424780330
OSS_REGION=oss-cn-shanghai
OSS_LEGACY_COS_BUCKET=原腾讯云Bucket名称
```

可选配置：

- `OSS_ENDPOINT=oss-accelerate.aliyuncs.com`：使用已开启的 OSS 传输加速。
- `OSS_PUBLIC_BASE_URL=https://static.example.com`：接入 CDN 后作为稳定资源地址。

后端按 `.env.local`、`.env.remote`、`.env.pay`、`.env` 的顺序加载配置。

## Bucket 权限

- Bucket 和对象保持私有；当前账号开启了“阻止公共访问”，代码不会尝试创建公共对象。
- 管理端和首页推荐图片通过后端 OSS 图片代理读取。
- 课程 PDF/Word 由后端通过 OSS SDK 鉴权读取。
- RAM 用户至少需要目标 Bucket 的 `GetObject`、`PutObject`、`DeleteObject`、`GetObjectMeta` 权限。

## 浏览器直传 CORS

Bucket 需要允许管理端和小程序业务域发起 `PUT`、`GET`、`HEAD` 请求，并允许 `Content-Type` 请求头，暴露 `ETag` 响应头。生产环境建议把 `AllowedOrigin` 从 `*` 收紧为实际 HTTPS 域名。

## 迁移兼容

`OSS_LEGACY_COS_BUCKET` 允许后端把数据库中尚未替换的旧 TCB URL 路径映射到 OSS 对象。文件迁移和数据库 URL 替换全部完成后，可删除该变量及兼容逻辑。

先预览数据库中受影响的表和行数：

```bash
npm run storage:rewrite-urls
```

确认文件迁移完成后执行事务化改写：

```bash
npm run storage:rewrite-urls:apply
```
