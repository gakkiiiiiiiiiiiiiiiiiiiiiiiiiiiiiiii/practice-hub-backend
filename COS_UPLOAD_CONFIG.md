# 微信云托管对象存储（COS）配置指南

## 概述

项目已集成微信云托管对象存储（COS）用于图片文件上传。**按照微信云托管官方文档实现**，使用临时密钥和文件元数据机制。

参考文档：[COS-SDK服务端使用](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/storage/service/cos-sdk.html)

## 配置信息

- **存储桶名称**: `7072-prod-6g7tpqs40c5a758b-1392943725`
- **地域**: `ap-shanghai`（上海）

## 环境变量配置

在 `.env` 文件中配置以下环境变量：

```env
# 腾讯云 COS 配置（用于图片上传）
# 注意：使用微信云托管时，不需要配置 SecretId 和 SecretKey
# 系统会自动通过 http://api.weixin.qq.com/_/cos/getauth 获取临时密钥
COS_BUCKET=7072-prod-6g7tpqs40c5a758b-1392943725
COS_REGION=ap-shanghai
```

### 重要说明

**不需要配置 SecretId 和 SecretKey！**

微信云托管会自动通过 `http://api.weixin.qq.com/_/cos/getauth` 获取临时密钥，系统会自动处理：
1. 获取临时密钥（自动刷新）
2. 获取文件元数据（必须，否则小程序端无法访问）
3. 上传文件时添加元数据头 `x-cos-meta-fileid`

## API 接口

### 上传图片

**接口地址**: `POST /api/admin/upload/image`

**请求头**:
```
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**请求参数**:
- `file`: 图片文件（FormData）
  - 支持格式: jpg, png, gif, webp
  - 最大大小: 5MB

**响应示例**:
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "url": "https://7072-prod-6g7tpqs40c5a758b-1392943725.cos.ap-shanghai.myqcloud.com/images/1234567890-abc123.jpg",
    "imageUrl": "https://7072-prod-6g7tpqs40c5a758b-1392943725.cos.ap-shanghai.myqcloud.com/images/1234567890-abc123.jpg"
  }
}
```

**权限要求**:
- 需要管理员登录（SuperAdmin 或 ContentAdmin）

## 文件存储路径

上传的图片会按照以下规则存储：

```
images/{timestamp}-{random}.{ext}
```

例如：
- `images/1703123456789-abc123def456.jpg`
- `images/1703123456790-xyz789ghi012.png`

## 文件访问

上传成功后，返回的 URL 可以直接访问，无需额外配置。

URL 格式：
```
https://{bucket}.cos.{region}.myqcloud.com/{key}
```

## 限制说明

1. **文件类型**: 仅支持 jpg、png、gif、webp
2. **文件大小**: 最大 5MB
3. **权限**: 需要管理员权限才能上传

## 微信云托管配置

### 在微信云托管控制台配置环境变量

1. 登录微信云托管控制台
2. 选择对应的服务
3. 进入「环境变量」配置
4. 添加以下环境变量：

```
COS_SECRET_ID=你的SecretId
COS_SECRET_KEY=你的SecretKey
COS_BUCKET=7072-prod-6g7tpqs40c5a758b-1392943725
COS_REGION=ap-shanghai
```

### 验证配置

部署后，可以通过以下方式验证：

1. **查看日志**: 启动日志中应该看到 COS 配置信息（如果有警告，说明配置未完成）
2. **测试上传**: 通过管理后台的图片上传功能测试
3. **检查 URL**: 上传成功后，检查返回的 URL 是否可以正常访问

## 工作原理

### 1. 临时密钥获取

系统会自动调用 `http://api.weixin.qq.com/_/cos/getauth` 获取临时密钥：
- 临时密钥会自动缓存，避免频繁请求
- 在过期前 60 秒自动刷新
- 无需手动配置 SecretId 和 SecretKey

### 2. 文件元数据

**重要**：上传文件时必须添加元数据 `x-cos-meta-fileid`，否则小程序端无法访问！

系统会自动：
1. 调用 `https://api.weixin.qq.com/_/cos/metaid/encode` 获取元数据
2. 在上传时添加 `x-cos-meta-fileid` 头
3. 管理端上传时，openid 传空字符串

### 3. 上传流程

```
1. 验证文件（类型、大小）
2. 生成唯一文件名
3. 获取文件元数据（必须）
4. 获取临时密钥（自动）
5. 上传到 COS（带元数据）
6. 返回文件 URL
```

## 常见问题

### Q: 上传失败，提示 "获取临时密钥失败"

A: 可能的原因：
- 服务未部署在微信云托管环境中
- 网络无法访问 `http://api.weixin.qq.com/_/cos/getauth`
- 检查服务日志查看详细错误信息

### Q: 上传成功，但小程序端无法访问图片

A: **这是最常见的问题！** 原因：
- 上传时未添加文件元数据 `x-cos-meta-fileid`
- 已修复：系统会自动获取并添加元数据

### Q: 上传失败，提示 "Access Denied"

A: 可能的原因：
- 临时密钥获取失败
- 存储桶配置错误
- 检查 `COS_BUCKET` 和 `COS_REGION` 是否正确

### Q: 图片 URL 无法访问

A: 检查：
- 存储桶的访问权限设置
- 是否开启了 CDN（如果开启了，需要使用 CDN 域名）
- 网络连接是否正常

### Q: 如何修改文件大小限制？

A: 修改 `src/modules/upload/upload.service.ts` 中的 `maxSize` 变量：

```typescript
const maxSize = 10 * 1024 * 1024; // 改为 10MB
```

### Q: 如何修改存储路径？

A: 修改上传接口调用时的 `folder` 参数，或修改 `upload.service.ts` 中的默认 `folder` 值。

## 相关文档

- [腾讯云 COS 文档](https://cloud.tencent.com/document/product/436)
- [微信云托管文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)

