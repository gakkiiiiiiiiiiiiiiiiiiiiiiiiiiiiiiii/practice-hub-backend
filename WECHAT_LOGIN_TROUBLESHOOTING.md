# 微信登录问题排查指南

## 常见错误

### 1. 401 错误 - 未授权

#### 错误：`self-signed certificate`
**原因**：SSL 证书验证失败（微信云托管环境常见）

**解决方案**：
- ✅ 已修复：后端代码已配置 `https.Agent` 跳过 SSL 证书验证
- 确保使用最新代码并重新部署

#### 错误：`微信登录配置错误，请联系管理员`
**原因**：环境变量未配置或配置错误

**解决方案**：
1. 检查 `.env` 文件或云托管环境变量
2. 确保 `WECHAT_APPID` 和 `WECHAT_SECRET` 已设置
3. 运行 `npm run check:wechat` 检查配置

#### 错误：微信 API 返回错误码

**常见错误码**：
- `40013` - 无效的 AppID
  - 检查 AppID 是否正确
  - 确保 AppID 和 Secret 来自同一个小程序
- `40125` - 无效的 Secret
  - 检查 Secret 是否正确
  - 确保 Secret 已启用（在微信公众平台中）
- `40029` - 登录凭证已过期
  - 这是正常的，code 只能使用一次
  - 需要从小程序重新获取 code
- `45011` - 登录请求过于频繁
  - 等待一段时间后重试
- `40163` - 登录凭证已被使用
  - code 只能使用一次，需要重新获取

## 排查步骤

### 步骤 1：检查配置

```bash
cd back-end
npm run check:wechat
```

### 步骤 2：测试微信 API

```bash
npm run test:wechat [code]
```

### 步骤 3：检查后端日志

查看后端服务日志，查找：
- `微信配置缺失` - 说明环境变量未配置
- `微信 API 错误` - 说明微信接口返回了错误
- `微信登录异常` - 说明网络或其他错误

### 步骤 4：验证环境变量

**本地开发**：
- 检查 `back-end/.env` 文件
- 确保 `WECHAT_APPID` 和 `WECHAT_SECRET` 已设置

**微信云托管**：
1. 登录微信云托管控制台
2. 进入服务配置 → 环境变量
3. 检查 `WECHAT_APPID` 和 `WECHAT_SECRET` 是否已配置
4. 如果修改了环境变量，需要重启服务

## 获取微信配置

1. 登录 [微信公众平台](https://mp.weixin.qq.com)
2. 进入"开发" → "开发管理" → "开发设置"
3. 查看"AppID(小程序ID)"和"AppSecret(小程序密钥)"
4. 如果 Secret 未启用，点击"启用"

## 测试工具

### 检查配置
```bash
npm run check:wechat
```

### 测试登录流程
```bash
npm run test:wechat [code]
```

## 完整检查清单

- [ ] 环境变量已配置（`WECHAT_APPID` 和 `WECHAT_SECRET`）
- [ ] AppID 和 Secret 来自同一个微信小程序
- [ ] Secret 已启用（在微信公众平台中）
- [ ] 后端代码已更新（包含 SSL 证书修复）
- [ ] 服务已重启（如果修改了环境变量）
- [ ] 服务器可以访问 `api.weixin.qq.com`
- [ ] 小程序已发布或已添加体验者

## 快速修复

如果遇到 `self-signed certificate` 错误：

1. ✅ **已修复**：代码已更新，包含 SSL 证书跳过配置
2. 重新构建并部署后端服务
3. 测试登录功能

如果遇到配置错误：

1. 检查环境变量配置
2. 运行 `npm run check:wechat` 验证
3. 如果使用云托管，在控制台检查环境变量
4. 重启服务使配置生效

## 联系支持

如果以上步骤都无法解决问题，请提供：
1. 后端服务日志（包含错误堆栈）
2. 配置检查结果（`npm run check:wechat`）
3. 测试结果（`npm run test:wechat`）

