# 故障排查指南

## Docker 相关问题

### 1. Docker daemon 未运行

**错误信息**：
```
Cannot connect to the Docker daemon at unix:///Users/pangyujie/.docker/run/docker.sock. 
Is the docker daemon running?
```

**解决方案**：

#### macOS / Windows
1. 打开 **Docker Desktop** 应用程序
2. 等待 Docker 完全启动（菜单栏图标不再闪烁）
3. 验证是否运行：
   ```bash
   docker ps
   ```
   如果显示容器列表或空列表（没有错误），说明 Docker 已启动

#### Linux
```bash
# 启动 Docker 服务
sudo systemctl start docker

# 设置开机自启
sudo systemctl enable docker

# 检查状态
sudo systemctl status docker
```

### 2. Docker Desktop 启动失败

**可能原因**：
- 系统资源不足
- 虚拟化未启用
- 权限问题

**解决方案**：
1. 重启 Docker Desktop
2. 检查系统资源（内存、CPU）
3. 确保虚拟化已启用（BIOS/UEFI 设置）
4. 查看 Docker Desktop 日志

### 3. 端口被占用

**错误信息**：
```
Bind for 0.0.0.0:3306 failed: port is already allocated
```

**解决方案**：

**方法一：修改 docker-compose.yml 端口映射**
```yaml
ports:
  - "3307:3306"  # 使用 3307 替代 3306
```

然后修改 `.env` 文件：
```env
DB_PORT=3307
```

**方法二：停止占用端口的服务**
```bash
# 查找占用端口的进程
lsof -i :3306
# 或
netstat -an | grep 3306

# 停止进程（替换 PID 为实际进程ID）
kill -9 <PID>
```

### 4. 容器启动失败

**查看日志**：
```bash
docker compose logs mysql
docker compose logs redis
```

**常见问题**：
- 密码设置问题
- 数据卷权限问题
- 镜像下载失败

**解决方案**：
```bash
# 停止并删除容器
docker compose down

# 清理数据卷（谨慎使用，会删除数据）
docker compose down -v

# 重新启动
docker compose up -d
```

## 数据库连接问题

### 1. MySQL 连接被拒绝

**检查项**：
1. MySQL 服务是否运行
2. 端口是否正确
3. 用户名密码是否正确
4. 防火墙设置

**测试连接**：
```bash
mysql -h localhost -P 3306 -u root -p
```

### 2. Redis 连接失败

**检查项**：
1. Redis 服务是否运行
2. 端口是否正确

**测试连接**：
```bash
redis-cli
ping
# 应该返回 PONG
```

## 项目启动问题

### 1. 依赖安装失败

```bash
# 清除缓存重新安装
rm -rf node_modules package-lock.json
npm install
```

### 2. 端口 3000 被占用

**修改端口**：
```env
# .env 文件
PORT=3001
```

### 3. 数据库同步失败

**检查**：
1. 数据库连接配置是否正确
2. 数据库是否存在
3. 用户权限是否足够

**手动创建数据库**：
```sql
CREATE DATABASE practice_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 环境变量问题

### 1. 环境变量未生效

确保：
1. `.env` 文件在 `back-end` 目录下
2. 文件名是 `.env`（不是 `env`）
3. 变量名和值格式正确

### 2. 敏感信息泄露

**不要**：
- 将 `.env` 文件提交到 Git
- 在代码中硬编码密码

**应该**：
- 使用 `.env` 文件（已在 .gitignore 中）
- 生产环境使用环境变量或密钥管理服务

## 常见错误代码

### ERR_CONNECTION_REFUSED
- 服务未启动
- 端口错误
- 防火墙阻止

### EACCES (权限错误)
- 文件权限问题
- Docker 权限问题（Linux）

### ECONNREFUSED
- 数据库服务未运行
- 连接配置错误

## 获取帮助

1. 查看日志：
   ```bash
   # Docker 日志
   docker compose logs -f
   
   # 项目日志
   npm run start:dev
   ```

2. 检查服务状态：
   ```bash
   docker ps
   docker compose ps
   ```

3. 重启服务：
   ```bash
   docker compose restart
   ```

