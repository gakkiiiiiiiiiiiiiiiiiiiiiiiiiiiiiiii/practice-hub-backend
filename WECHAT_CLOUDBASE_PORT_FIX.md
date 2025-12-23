# 微信云托管端口权限问题修复

## 错误信息

```
Error: listen EACCES: permission denied 0.0.0.0:80
```

## 问题分析

在 Linux 系统中，1024 以下的端口（如 80）需要 root 权限才能监听。但是：

1. **Dockerfile 使用了非 root 用户**：为了安全，Dockerfile 切换到 `nestjs` 用户运行
2. **非 root 用户无法监听 80 端口**：导致权限错误

## 解决方案

### 方案一：使用 8080 端口（推荐，已修复）

**优点**：
- ✅ 不需要 root 权限
- ✅ 更安全
- ✅ 微信云托管支持端口映射

**配置**：
- 应用监听 `8080` 端口
- 微信云托管会自动映射到外部端口

**环境变量**：
```env
PORT=8080  # 默认值，可以修改
```

### 方案二：使用 root 用户（不推荐）

如果必须使用 80 端口，可以修改 Dockerfile：

```dockerfile
# 移除用户切换
# USER nestjs

# 使用 root 用户运行
CMD ["node", "dist/main.js"]
```

**缺点**：
- ❌ 安全性差
- ❌ 不符合最佳实践

### 方案三：使用 CAP_NET_BIND_SERVICE（复杂）

给非 root 用户绑定低端口的能力，但配置复杂，不推荐。

## 已修复的配置

### Dockerfile

```dockerfile
# 暴露端口
EXPOSE 8080

# 环境变量
ENV PORT=8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
```

### main.ts

```typescript
// 默认使用 8080 端口
const port = parseInt(process.env.PORT || '8080', 10);
await app.listen(port, '0.0.0.0');
```

## 微信云托管配置

### 环境变量

在微信云托管控制台配置：

```env
PORT=8080  # 可选，默认就是 8080
```

### 端口映射

微信云托管会自动处理端口映射：
- 内部端口：8080（应用监听）
- 外部端口：由微信云托管自动分配或配置

## 验证

部署后，检查启动日志应该看到：

```
🚀 服务启动成功: http://0.0.0.0:8080
📚 API 文档: http://0.0.0.0:8080/api-docs
```

不应该有权限错误。

## 常见问题

### Q: 为什么不能使用 80 端口？

A: 在 Linux 系统中，1024 以下的端口需要 root 权限。使用非 root 用户运行应用是安全最佳实践，所以使用 8080 端口。

### Q: 微信云托管会自动映射端口吗？

A: 是的，微信云托管会自动处理端口映射，外部访问不需要关心内部端口。

### Q: 可以修改为其他端口吗？

A: 可以，通过环境变量 `PORT` 配置，例如 `PORT=3000`。

## 相关文档

- [DEPLOY.md](./DEPLOY.md) - 部署指南
- [DEPLOY_TROUBLESHOOTING.md](./DEPLOY_TROUBLESHOOTING.md) - 部署故障排查

