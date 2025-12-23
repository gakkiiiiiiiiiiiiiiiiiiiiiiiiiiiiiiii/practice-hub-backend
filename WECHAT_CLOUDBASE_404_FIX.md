# 微信云托管 404 错误排查指南

## 问题描述

服务部署到微信云托管后，接口调用返回 404 Not Found。

## 常见原因

### 1. 路径映射配置问题（最常见）

微信云托管需要配置路径映射，将请求转发到正确的路径。

#### 解决方案

在微信云托管控制台配置路径映射：

1. **进入服务配置**
   - 登录微信云托管控制台
   - 选择对应的服务
   - 进入"服务配置" → "路径映射"

2. **添加路径映射规则**

   **方式一：配置根路径映射（推荐）**
   ```
   路径: /
   目标路径: /api
   说明: 将所有请求转发到 /api 前缀
   ```

   **方式二：配置具体路径映射**
   ```
   路径: /api
   目标路径: /api
   说明: 保持原路径不变
   ```

3. **保存并重新部署**

### 2. API 前缀问题

应用设置了全局前缀 `api`，所以所有接口路径都是 `/api/xxx`。

#### 接口路径示例

- ✅ 正确：`https://your-domain.com/api/app/home/config`
- ✅ 正确：`https://your-domain.com/api/auth/app/login`
- ❌ 错误：`https://your-domain.com/app/home/config`（缺少 `/api` 前缀）

#### 解决方案

**方案 A：前端添加 `/api` 前缀（推荐）**

在前端请求配置中添加 `/api` 前缀：

```javascript
// 小程序端
const baseURL = 'https://your-domain.com/api';

// 管理后台
const baseURL = 'https://your-domain.com/api';
```

**方案 B：移除全局前缀（不推荐）**

如果不想使用 `/api` 前缀，可以修改 `src/main.ts`：

```typescript
// 注释掉或删除这行
// app.setGlobalPrefix('api');
```

但需要确保所有接口路径都更新。

### 3. 端口配置问题

微信云托管可能使用不同的端口或路径。

#### 检查步骤

1. **查看服务日志**
   - 确认服务启动成功
   - 查看监听的端口

2. **检查环境变量**
   ```env
   PORT=80  # 微信云托管默认端口
   ```

3. **测试健康检查**
   ```bash
   curl https://your-domain.com/api
   curl https://your-domain.com/api/health
   ```

### 4. 路由注册问题

确保所有控制器都已正确注册到模块中。

#### 检查清单

- ✅ 所有 Controller 都在对应的 Module 中声明
- ✅ 所有 Module 都在 `app.module.ts` 中导入
- ✅ 没有路由冲突

### 5. 微信云托管路径前缀

某些微信云托管配置可能自动添加路径前缀。

#### 解决方案

如果微信云托管自动添加了路径前缀（如 `/service-name`），需要：

1. **在路径映射中配置**
   ```
   路径: /service-name/api
   目标路径: /api
   ```

2. **或在前端配置中调整**
   ```javascript
   const baseURL = 'https://your-domain.com/service-name/api';
   ```

## 快速诊断步骤

### 步骤 1：检查服务是否启动

查看服务日志，确认：
- ✅ 服务启动成功
- ✅ 监听的端口正确
- ✅ 没有启动错误

### 步骤 2：测试根路径

```bash
# 测试根路径
curl https://your-domain.com/

# 测试健康检查
curl https://your-domain.com/api/health

# 测试 API 路径
curl https://your-domain.com/api
```

### 步骤 3：测试具体接口

```bash
# 测试登录接口
curl -X POST https://your-domain.com/api/auth/app/login \
  -H "Content-Type: application/json" \
  -d '{"code":"test"}'

# 测试首页配置
curl https://your-domain.com/api/app/home/config
```

### 步骤 4：检查路径映射

在微信云托管控制台检查：
- ✅ 路径映射配置是否正确
- ✅ 目标路径是否匹配
- ✅ 是否有路径冲突

## 配置示例

### 微信云托管路径映射配置

```
路径规则配置：
┌─────────────┬──────────────┬──────────┐
│   路径      │   目标路径   │   说明   │
├─────────────┼──────────────┼──────────┤
│ /           │ /api         │ 根路径   │
│ /api        │ /api         │ API路径  │
│ /api-docs   │ /api-docs    │ 文档路径 │
└─────────────┴──────────────┴──────────┘
```

### 前端请求配置

**小程序端 (`font-end/utils/request.js`)**

```javascript
const baseURL = 'https://your-domain.com/api';

// 或使用环境变量
const baseURL = process.env.API_BASE_URL || 'https://your-domain.com/api';
```

**管理后台 (`admin-web/src/utils/request.ts`)**

```typescript
const baseURL = import.meta.env.VITE_API_BASE_URL || 'https://your-domain.com/api';
```

## 常见错误示例

### 错误 1：路径缺少 `/api` 前缀

**请求**：`GET https://your-domain.com/app/home/config`
**错误**：404 Not Found

**解决**：使用 `https://your-domain.com/api/app/home/config`

### 错误 2：路径映射配置错误

**请求**：`GET https://your-domain.com/api/app/home/config`
**错误**：404 Not Found

**解决**：在微信云托管配置路径映射，将 `/api` 映射到 `/api`

### 错误 3：服务未启动

**请求**：任何请求
**错误**：Connection refused 或 502 Bad Gateway

**解决**：检查服务日志，确保服务正常启动

## 调试技巧

### 1. 添加日志

在 `main.ts` 中添加路由日志：

```typescript
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
```

### 2. 测试本地部署

使用 Docker 本地测试：

```bash
docker build -t practice-hub-backend .
docker run -p 80:80 \
  -e DB_HOST=xxx \
  -e DB_PASSWORD=xxx \
  practice-hub-backend

# 测试
curl http://localhost/api
curl http://localhost/api/health
```

### 3. 查看微信云托管日志

在微信云托管控制台查看：
- 服务日志
- 访问日志
- 错误日志

## 验证清单

部署后，验证以下接口是否正常：

- [ ] `GET /api` - 根路径健康检查
- [ ] `GET /api/health` - 健康检查
- [ ] `POST /api/auth/app/login` - 小程序登录
- [ ] `POST /api/auth/admin/login` - 管理后台登录
- [ ] `GET /api/app/home/config` - 首页配置
- [ ] `GET /api-docs` - API 文档

## 联系支持

如果以上方法都无法解决问题：

1. 收集完整的错误日志
2. 记录请求路径和响应
3. 检查微信云托管配置
4. 联系微信云托管技术支持

## 相关文档

- [微信云托管文档](https://cloud.tencent.com/document/product/876)
- [NestJS 路由文档](https://docs.nestjs.com/controllers#routing)
- [DEPLOY.md](./DEPLOY.md) - 部署指南
- [DEPLOY_TROUBLESHOOTING.md](./DEPLOY_TROUBLESHOOTING.md) - 部署故障排查

