# 数据库和 Redis 密码查看指南

## 查看密码位置

### 1. Docker Compose 配置中的密码

查看 `docker-compose.yml` 文件：

```bash
cat docker-compose.yml
```

**MySQL 密码配置**：
- **Root 密码**：`MYSQL_ROOT_PASSWORD: root123456`
- **普通用户**：`practice_user` / `practice_pass`
- **数据库名**：`practice_hub`

**Redis 密码配置**：
- 默认配置中 **Redis 没有设置密码**（空密码）
- 如果需要设置密码，需要修改配置

### 2. 环境变量文件中的密码

查看 `.env` 文件：

```bash
cat .env
```

或使用编辑器打开：
```bash
# macOS / Linux
nano .env
# 或
vim .env

# 如果有 VS Code
code .env
```

## 当前默认密码

根据 `docker-compose.yml` 配置：

### MySQL
- **用户名**：`root`
- **密码**：`root123456`
- **数据库**：`practice_hub`
- **端口**：`3306`

### Redis
- **密码**：无（空密码）
- **端口**：`6379`

## 修改密码

### 修改 MySQL 密码

#### 方法一：修改 docker-compose.yml（推荐，适用于新安装）

1. 编辑 `docker-compose.yml`：
```yaml
environment:
  MYSQL_ROOT_PASSWORD: your_new_password  # 修改这里
  MYSQL_DATABASE: practice_hub
  MYSQL_USER: practice_user
  MYSQL_PASSWORD: your_user_password      # 修改这里
```

2. 重新创建容器：
```bash
docker compose down -v  # 注意：这会删除所有数据
docker compose up -d
```

#### 方法二：在运行中的容器中修改（保留数据）

1. 进入 MySQL 容器：
```bash
docker exec -it practice_hub_mysql mysql -u root -p
# 输入当前密码：root123456
```

2. 修改密码：
```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'your_new_password';
ALTER USER 'root'@'%' IDENTIFIED BY 'your_new_password';
FLUSH PRIVILEGES;
```

3. 更新 `.env` 文件：
```env
DB_PASSWORD=your_new_password
```

### 修改 Redis 密码

#### 方法一：修改 docker-compose.yml（推荐）

1. 编辑 `docker-compose.yml`，在 Redis 服务中添加密码：
```yaml
redis:
  image: redis:7-alpine
  container_name: practice_hub_redis
  restart: always
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  command: redis-server --requirepass your_redis_password --appendonly yes
  # 添加 --requirepass 参数设置密码
```

2. 重启容器：
```bash
docker compose restart redis
```

3. 更新 `.env` 文件：
```env
REDIS_PASSWORD=your_redis_password
```

#### 方法二：在运行中的容器中修改

1. 进入 Redis 容器：
```bash
docker exec -it practice_hub_redis redis-cli
```

2. 设置密码：
```redis
CONFIG SET requirepass your_redis_password
```

3. 更新配置文件（持久化）：
```bash
# 编辑 Redis 配置文件
docker exec -it practice_hub_redis sh
echo "requirepass your_redis_password" >> /data/redis.conf
```

## 验证密码

### 测试 MySQL 密码

```bash
# 使用命令行连接
mysql -h localhost -P 3306 -u root -p
# 输入密码：root123456

# 或使用 Docker
docker exec -it practice_hub_mysql mysql -u root -p
# 输入密码：root123456
```

### 测试 Redis 密码

```bash
# 如果设置了密码
redis-cli -a your_redis_password

# 如果没有密码
redis-cli

# 测试连接
ping
# 应该返回 PONG
```

## 安全建议

### 生产环境

1. **使用强密码**：
   - 至少 16 个字符
   - 包含大小写字母、数字、特殊字符
   - 不要使用默认密码

2. **使用环境变量**：
   ```yaml
   # docker-compose.yml
   environment:
     MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
   ```
   然后在 `.env` 文件中设置（不要提交到 Git）

3. **限制访问**：
   - 不要暴露数据库端口到公网
   - 使用防火墙规则
   - 使用 VPN 或私有网络

4. **定期更换密码**：
   - 定期更新密码
   - 使用密码管理工具

## 忘记密码怎么办

### MySQL 重置密码

1. 停止容器：
```bash
docker compose stop mysql
```

2. 启动容器（跳过权限检查）：
```bash
docker run -it --rm \
  -v practice_hub_mysql_data:/var/lib/mysql \
  mysql:8.0 \
  mysqld --skip-grant-tables
```

3. 在另一个终端连接并重置：
```bash
docker exec -it practice_hub_mysql mysql -u root
ALTER USER 'root'@'%' IDENTIFIED BY 'new_password';
FLUSH PRIVILEGES;
```

### Redis 重置密码

如果设置了密码但忘记了：

1. 停止容器：
```bash
docker compose stop redis
```

2. 删除数据卷（会丢失数据）：
```bash
docker volume rm practice_hub_redis_data
```

3. 重新启动：
```bash
docker compose up -d redis
```

## 快速查看命令

```bash
# 查看 MySQL 配置
docker exec practice_hub_mysql env | grep MYSQL

# 查看 Redis 配置
docker exec practice_hub_redis redis-cli CONFIG GET requirepass

# 查看所有环境变量
docker compose config
```

