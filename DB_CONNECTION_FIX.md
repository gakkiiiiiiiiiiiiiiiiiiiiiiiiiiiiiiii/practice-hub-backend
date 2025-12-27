# 数据库连接问题修复指南

## 问题：ECONNRESET 错误

**错误信息：**
```
QueryFailedError: read ECONNRESET
```

**原因：**
- 数据库连接被服务器重置
- 连接超时
- 连接池配置不当
- 网络不稳定

## 已实施的修复

### 1. 连接池配置优化

在 `app.module.ts` 中添加了以下配置：

```typescript
extra: {
  // 连接池最大连接数
  connectionLimit: 10,
  // 连接超时时间（毫秒）
  connectTimeout: 60000,
  // 获取连接超时时间（毫秒）
  acquireTimeout: 60000,
  // 连接空闲超时时间（毫秒）
  idleTimeout: 300000,
  // 连接最大存活时间（毫秒）
  maxIdle: 10000,
  // 启用连接自动重连
  reconnect: true,
  // 连接被重置时自动重连
  enableKeepAlive: true,
  // Keep-alive 初始延迟（毫秒）
  keepAliveInitialDelay: 0,
  // 是否在连接断开时自动重连
  autoReconnect: true,
  // 连接重试次数
  reconnectAttempts: 5,
  // 连接重试延迟（毫秒）
  reconnectDelay: 2000,
}
```

### 2. 查询重试机制

在 `QuestionService` 中添加了 `queryWithRetry` 方法，自动重试失败的数据库查询：

- 默认重试 3 次
- 每次重试延迟递增（1秒、2秒、3秒）
- 只对连接错误（ECONNRESET、ECONNREFUSED、ETIMEDOUT）进行重试
- 其他错误直接抛出

### 3. 错误日志增强

所有数据库查询错误都会记录详细的日志信息，包括：
- 错误类型和消息
- 堆栈跟踪
- 上下文信息（章节ID、用户ID等）

## 配置说明

### 连接池参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `connectionLimit` | 最大连接数 | 10 |
| `connectTimeout` | 连接超时（毫秒） | 60000 |
| `acquireTimeout` | 获取连接超时（毫秒） | 60000 |
| `idleTimeout` | 空闲连接超时（毫秒） | 300000 |
| `maxIdle` | 最大空闲连接数 | 10000 |
| `reconnectAttempts` | 重连尝试次数 | 5 |
| `reconnectDelay` | 重连延迟（毫秒） | 2000 |

### 重试机制参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `retries` | 最大重试次数 | 3 |
| `delay` | 初始延迟（毫秒） | 1000 |

## 使用建议

### 生产环境

1. **监控连接池状态**
   - 定期检查连接池使用情况
   - 监控连接错误率
   - 设置告警阈值

2. **数据库服务器配置**
   - 确保 `wait_timeout` 和 `interactive_timeout` 设置合理（建议 28800 秒）
   - 检查 `max_connections` 限制
   - 启用慢查询日志

3. **网络稳定性**
   - 使用云数据库服务（更稳定）
   - 确保应用和数据库在同一区域
   - 配置数据库安全组规则

### 开发环境

1. **本地 Docker 环境**
   - 使用 `docker-compose.yml` 中的 MySQL 配置
   - 确保容器正常运行
   - 检查端口映射

2. **调试连接问题**
   ```bash
   # 检查 MySQL 连接
   docker exec practice_hub_mysql mysql -u root -proot123456 -e "SELECT 1;"
   
   # 查看连接状态
   docker exec practice_hub_mysql mysql -u root -proot123456 -e "SHOW PROCESSLIST;"
   ```

## 常见问题

### 1. 连接数过多

**症状：** `Too many connections` 错误

**解决：**
- 增加 `max_connections`（MySQL 配置）
- 减少 `connectionLimit`（应用配置）
- 检查是否有连接泄漏

### 2. 连接超时

**症状：** `ETIMEDOUT` 或 `ECONNRESET` 错误

**解决：**
- 增加 `connectTimeout` 和 `acquireTimeout`
- 检查网络延迟
- 检查数据库服务器负载

### 3. 连接被重置

**症状：** `ECONNRESET` 错误

**解决：**
- 启用 `enableKeepAlive`（已配置）
- 启用 `autoReconnect`（已配置）
- 检查数据库服务器的 `wait_timeout` 设置

## 监控和调试

### 查看连接池状态

```typescript
// 在代码中添加日志
const dataSource = app.get(DataSource);
console.log('连接池状态:', {
  active: dataSource.driver.pool?.activeConnections,
  idle: dataSource.driver.pool?.idleConnections,
  total: dataSource.driver.pool?.totalConnections,
});
```

### 查看数据库连接状态

```sql
-- 查看当前连接数
SHOW STATUS LIKE 'Threads_connected';

-- 查看最大连接数
SHOW VARIABLES LIKE 'max_connections';

-- 查看连接超时设置
SHOW VARIABLES LIKE '%timeout%';

-- 查看当前所有连接
SHOW PROCESSLIST;
```

## 进一步优化

如果问题仍然存在，可以考虑：

1. **使用连接池中间件**
   - 如 `pgBouncer`（PostgreSQL）或 `ProxySQL`（MySQL）

2. **实现连接健康检查**
   - 定期 ping 数据库连接
   - 自动关闭无效连接

3. **使用读写分离**
   - 减少主库连接压力
   - 提高查询性能

4. **实现缓存层**
   - 减少数据库查询次数
   - 使用 Redis 缓存热点数据
