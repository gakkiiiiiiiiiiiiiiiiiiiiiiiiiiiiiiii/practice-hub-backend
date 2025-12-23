# 微信云托管部署故障排查指南

## 常见错误

### 1. 数据库连接失败 (ECONNREFUSED)

**错误信息：**
```
[Nest] ERROR [TypeOrmModule] Unable to connect to the database. Retrying (1)...
AggregateError [ECONNREFUSED]
```

**原因：**
- 环境变量未正确配置
- 数据库地址/端口错误
- 数据库安全组未开放微信云托管 IP
- 数据库用户名/密码错误

**解决方案：**

1. **检查环境变量配置**
   在微信云托管控制台 → 服务配置 → 环境变量中，确保配置了以下变量：
   ```
   DB_HOST=你的数据库地址（如：sh-cdbrg-xxxxx.sql.tencentcdb.com）
   DB_PORT=3306
   DB_USERNAME=你的数据库用户名
   DB_PASSWORD=你的数据库密码
   DB_DATABASE=practice_hub
   ```

2. **检查数据库类型**
   - 推荐使用腾讯云 MySQL（与微信云托管同区域）
   - 确保数据库版本为 MySQL 5.7+ 或 MySQL 8.0+

3. **检查安全组规则**
   - 在腾讯云控制台 → 数据库 → 安全组
   - 添加规则：允许微信云托管的 IP 段访问 3306 端口
   - 或者设置为"允许所有 IP"（仅用于测试）

4. **检查数据库用户权限**
   ```sql
   -- 确保用户有远程访问权限
   GRANT ALL PRIVILEGES ON practice_hub.* TO 'your_username'@'%' IDENTIFIED BY 'your_password';
   FLUSH PRIVILEGES;
   ```

5. **测试数据库连接**
   在微信云托管控制台查看日志，应该能看到：
   ```
   [数据库配置] 连接地址: xxx:3306, 数据库: practice_hub, 用户: xxx
   ```

### 2. Redis 连接失败 (ECONNREFUSED)

**错误信息：**
```
[ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
```

**原因：**
- Redis 环境变量未配置
- Redis 地址/端口错误
- Redis 安全组未开放
- Redis 密码错误

**解决方案：**

1. **检查环境变量配置**
   ```
   REDIS_HOST=你的Redis地址（如：10.x.x.x）
   REDIS_PORT=6379
   REDIS_PASSWORD=你的Redis密码（如果没有密码，留空）
   REDIS_DB=0
   ```

2. **使用微信云托管提供的 Redis**
   - 微信云托管可能提供内置 Redis
   - 查看微信云托管文档获取 Redis 连接信息

3. **使用腾讯云 Redis**
   - 推荐使用腾讯云 Redis（与微信云托管同区域）
   - 确保安全组允许微信云托管 IP 访问 6379 端口

4. **检查 Redis 连接日志**
   在日志中应该能看到：
   ```
   [Redis配置] 连接地址: xxx:6379, DB: 0
   [Redis] 连接成功
   ```

### 3. authPlugin 配置警告

**错误信息：**
```
Ignoring invalid configuration option passed to Connection: authPlugin.
```

**解决方案：**
- ✅ 已在最新版本中修复
- 已移除 `authPlugin` 配置
- 如果仍有警告，请确保使用最新代码

### 4. 应用启动失败

**检查清单：**

1. **环境变量完整性**
   ```
   ✅ DB_HOST
   ✅ DB_PORT
   ✅ DB_USERNAME
   ✅ DB_PASSWORD
   ✅ DB_DATABASE
   ✅ REDIS_HOST
   ✅ REDIS_PORT
   ✅ JWT_SECRET
   ✅ WECHAT_APPID
   ✅ WECHAT_SECRET
   ✅ PORT (可选，默认 80)
   ✅ NODE_ENV=production
   ```

2. **端口配置**
   - 微信云托管默认使用 80 端口
   - 应用会自动监听 `0.0.0.0:80`
   - 可以通过环境变量 `PORT` 修改

3. **健康检查**
   - 应用启动后，访问 `/api` 应该返回正常响应
   - 健康检查会每 30 秒检查一次

## 环境变量配置示例

在微信云托管控制台配置以下环境变量：

```bash
# 数据库配置
DB_HOST=sh-cdbrg-xxxxx.sql.tencentcdb.com
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_secure_password
DB_DATABASE=practice_hub

# Redis 配置
REDIS_HOST=10.x.x.x
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT 配置
JWT_SECRET=your_very_secure_jwt_secret_key_min_32_chars
JWT_EXPIRE=7d

# 微信小程序配置
WECHAT_APPID=wx1234567890abcdef
WECHAT_SECRET=your_wechat_secret_key

# 服务器配置
PORT=80
NODE_ENV=production

# 可选配置
COUNTDOWN_DATE=2024-12-23
```

## 调试步骤

1. **查看部署日志**
   - 微信云托管控制台 → 服务 → 日志
   - 查看启动日志和错误信息

2. **检查环境变量**
   - 确认所有必需的环境变量都已配置
   - 检查环境变量值是否正确（无多余空格）

3. **测试数据库连接**
   - 使用 MySQL 客户端测试数据库连接
   - 确认可以从微信云托管网络访问数据库

4. **测试 Redis 连接**
   - 使用 Redis 客户端测试连接
   - 确认可以从微信云托管网络访问 Redis

5. **查看应用日志**
   - 应用启动后，查看日志中的配置信息
   - 确认数据库和 Redis 连接成功

## 常见问题

### Q: 数据库连接超时怎么办？
A: 
1. 检查数据库是否在运行
2. 检查安全组规则
3. 检查数据库地址是否正确
4. 尝试使用内网地址（如果数据库和云托管在同一区域）

### Q: Redis 连接失败，应用还能运行吗？
A: 
- 应用会尝试重连 Redis
- 如果 Redis 不可用，某些功能（如缓存、排行榜）可能不可用
- 建议配置 Redis 以确保所有功能正常

### Q: 如何查看详细的连接日志？
A: 
- 在微信云托管控制台查看服务日志
- 应用启动时会输出数据库和 Redis 配置信息
- 连接成功/失败都会有日志记录

### Q: 本地可以连接，但云托管连接失败？
A: 
- 检查安全组规则（云托管 IP 可能不在白名单中）
- 检查数据库是否允许远程连接
- 检查防火墙设置

## 联系支持

如果以上方法都无法解决问题，请：
1. 收集完整的错误日志
2. 检查环境变量配置
3. 联系微信云托管技术支持

