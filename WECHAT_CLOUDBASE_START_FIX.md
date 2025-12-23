# 微信云托管启动错误修复指南

## 错误信息

```
> wxcloudrun-express@1.0.0 start /app
> node index.js

SequelizeConnectionRefusedError: connect ECONNREFUSED 127.0.0.1:3306
```

## 问题分析

这个错误表明：

1. **错误的项目被启动**：微信云托管启动了 `wxcloudrun-express` 项目（示例项目），而不是我们的 NestJS 项目
2. **使用了错误的启动命令**：使用了 `node index.js` 而不是 `node dist/main.js`
3. **使用了错误的 ORM**：使用了 Sequelize 而不是 TypeORM

## 解决方案

### 方案一：确保使用 Dockerfile 部署（推荐）

在微信云托管控制台配置：

1. **进入服务配置**
   - 登录微信云托管控制台
   - 选择对应的服务
   - 进入"服务配置"

2. **配置构建方式**
   - 构建方式：选择 **Dockerfile**
   - Dockerfile 路径：`back-end/Dockerfile` 或 `Dockerfile`
   - 不要使用"代码部署"或"npm start"方式

3. **确认启动命令**
   - 确保使用 Dockerfile 中的 `CMD ["node", "dist/main.js"]`
   - 不要使用 package.json 中的 `start` 脚本（如果配置错误）

### 方案二：修复 package.json 的 start 脚本

确保 `package.json` 中的 `start` 脚本正确：

```json
{
  "scripts": {
    "start": "node dist/main.js",
    "start:prod": "node dist/main.js"
  }
}
```

### 方案三：检查部署配置

1. **确认代码目录**
   - 确保部署的是 `back-end` 目录
   - 不是根目录或其他目录

2. **确认分支**
   - 确保使用正确的分支（如 `master`）

3. **确认构建配置**
   - 构建方式：Dockerfile
   - 工作目录：`back-end`（如果 Dockerfile 在 back-end 目录）

## 正确的部署配置

### Dockerfile 配置（已正确）

```dockerfile
# 启动应用
CMD ["node", "dist/main.js"]
```

### package.json 配置（已修复）

```json
{
  "scripts": {
    "start": "node dist/main.js",
    "start:prod": "node dist/main.js"
  }
}
```

## 检查清单

部署前检查：

- [ ] Dockerfile 存在且正确
- [ ] `package.json` 中有正确的 `start` 脚本
- [ ] 微信云托管配置使用 Dockerfile 构建
- [ ] 工作目录指向 `back-end`
- [ ] 环境变量已正确配置
- [ ] 数据库连接信息正确（不是 `127.0.0.1`）

## 环境变量配置

确保在微信云托管控制台配置了正确的数据库连接：

```env
DB_HOST=外网数据库地址（不是 127.0.0.1）
DB_PORT=3306
DB_USERNAME=用户名
DB_PASSWORD=密码
DB_DATABASE=practice_hub
```

**重要**：`DB_HOST` 不能是 `127.0.0.1` 或 `localhost`，必须是外网可访问的数据库地址。

## 验证步骤

### 1. 检查构建日志

在微信云托管控制台查看构建日志，确认：
- ✅ 使用了正确的 Dockerfile
- ✅ 构建成功
- ✅ 生成了 `dist` 目录

### 2. 检查启动日志

查看服务启动日志，确认：
- ✅ 启动命令是 `node dist/main.js`
- ✅ 不是 `node index.js`
- ✅ 没有 Sequelize 相关错误

### 3. 检查环境变量

确认环境变量：
- ✅ `DB_HOST` 是外网地址
- ✅ 所有必需的变量都已配置

## 常见错误

### 错误 1：使用了示例项目

**现象**：日志显示 `wxcloudrun-express`

**解决**：
- 检查部署的代码目录
- 确保部署的是 `back-end` 目录
- 确保没有示例文件（如 `index.js`）

### 错误 2：启动命令错误

**现象**：日志显示 `node index.js`

**解决**：
- 确保使用 Dockerfile 部署
- 检查 Dockerfile 的 CMD 指令
- 确保 `package.json` 的 `start` 脚本正确

### 错误 3：数据库连接地址错误

**现象**：`connect ECONNREFUSED 127.0.0.1:3306`

**解决**：
- 检查环境变量 `DB_HOST`
- 确保是外网可访问的地址
- 不是 `127.0.0.1` 或 `localhost`

## 重新部署步骤

1. **清理旧部署**
   - 删除旧的服务版本（如果需要）

2. **检查配置**
   - 确认使用 Dockerfile 构建
   - 确认工作目录正确
   - 确认环境变量配置

3. **重新部署**
   - 点击"重新部署"
   - 等待构建完成

4. **验证启动**
   - 查看启动日志
   - 确认没有错误
   - 测试健康检查接口

## 联系支持

如果问题仍然存在：

1. 提供完整的构建日志
2. 提供完整的启动日志
3. 提供 Dockerfile 内容
4. 提供环境变量配置（隐藏敏感信息）
5. 联系微信云托管技术支持

