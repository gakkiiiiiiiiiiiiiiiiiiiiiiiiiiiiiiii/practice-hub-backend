# 数据库启动指南

本项目需要 MySQL 8.0 和 Redis。以下是几种启动方式：

## 方式一：使用 Docker（推荐，最简单）

### 1. 创建 docker-compose.yml

在项目根目录创建 `docker-compose.yml` 文件：

```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    container_name: practice_hub_mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: root123456
      MYSQL_DATABASE: practice_hub
      MYSQL_USER: practice_user
      MYSQL_PASSWORD: practice_pass
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    command: --default-authentication-plugin=mysql_native_password --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci

  redis:
    image: redis:7-alpine
    container_name: practice_hub_redis
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  mysql_data:
  redis_data:
```

### 2. 启动服务

**注意**：新版本的 Docker 使用 `docker compose`（没有横杠），旧版本使用 `docker-compose`

```bash
# 方式一：使用新版本命令（推荐）
docker compose up -d

# 方式二：如果上面命令不行，尝试旧版本命令
docker-compose up -d

# 查看运行状态
docker compose ps
# 或
docker-compose ps

# 查看日志
docker compose logs -f
# 或
docker-compose logs -f

# 停止服务
docker compose down
# 或
docker-compose down

# 停止并删除数据（谨慎使用）
docker compose down -v
# 或
docker-compose down -v
```

### 3. 配置 .env 文件

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=root123456
DB_DATABASE=practice_hub

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

## 方式二：本地安装启动

### MySQL 8.0

#### macOS

```bash
# 使用 Homebrew 安装
brew install mysql@8.0

# 启动 MySQL
brew services start mysql@8.0

# 或者手动启动
mysql.server start

# 设置 root 密码
mysql_secure_installation

# 创建数据库
mysql -u root -p
CREATE DATABASE practice_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

#### Linux (Ubuntu/Debian)

```bash
# 安装 MySQL
sudo apt update
sudo apt install mysql-server

# 启动 MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# 设置 root 密码
sudo mysql_secure_installation

# 创建数据库
sudo mysql -u root -p
CREATE DATABASE practice_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

#### Windows

1. 下载 MySQL 8.0 安装包：https://dev.mysql.com/downloads/mysql/
2. 运行安装程序，按提示安装
3. 启动 MySQL 服务（在服务管理器中）
4. 使用 MySQL Workbench 或命令行创建数据库

### Redis

#### macOS

```bash
# 使用 Homebrew 安装
brew install redis

# 启动 Redis
brew services start redis

# 或者手动启动
redis-server
```

#### Linux (Ubuntu/Debian)

```bash
# 安装 Redis
sudo apt update
sudo apt install redis-server

# 启动 Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 检查状态
sudo systemctl status redis-server
```

#### Windows

1. 下载 Redis for Windows：https://github.com/microsoftarchive/redis/releases
2. 解压并运行 `redis-server.exe`
3. 或使用 WSL2 运行 Linux 版本的 Redis

## 方式三：使用云服务

### 阿里云 / 腾讯云

1. 在云控制台创建 MySQL 实例（选择 MySQL 8.0）
2. 在云控制台创建 Redis 实例
3. 获取连接地址和端口
4. 配置 `.env` 文件中的连接信息

## 验证连接

### 测试 MySQL 连接

```bash
# 使用命令行连接
mysql -h localhost -P 3306 -u root -p

# 或使用 Node.js 测试脚本
node -e "
const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'your_password',
      database: 'practice_hub'
    });
    console.log('MySQL 连接成功！');
    await conn.end();
  } catch (err) {
    console.error('MySQL 连接失败：', err.message);
  }
})();
"
```

### 测试 Redis 连接

```bash
# 使用命令行连接
redis-cli

# 测试命令
ping
# 应该返回 PONG

# 或使用 Node.js 测试脚本
node -e "
const Redis = require('ioredis');
const redis = new Redis({
  host: 'localhost',
  port: 6379
});
redis.ping().then(result => {
  console.log('Redis 连接成功！', result);
  redis.quit();
}).catch(err => {
  console.error('Redis 连接失败：', err.message);
});
"
```

## 数据库初始化

项目启动后，TypeORM 会自动创建表结构（开发环境）。

如果需要手动初始化，可以：

1. **使用 TypeORM 迁移**（推荐生产环境）
2. **直接运行项目**（开发环境会自动同步）

## 常见问题

### 1. MySQL 连接被拒绝

- 检查 MySQL 服务是否启动
- 检查端口是否正确（默认 3306）
- 检查防火墙设置
- 检查用户权限

### 2. Redis 连接失败

- 检查 Redis 服务是否启动
- 检查端口是否正确（默认 6379）
- 检查 Redis 配置

### 3. 字符集问题

确保 MySQL 使用 utf8mb4 字符集：

```sql
-- 检查字符集
SHOW VARIABLES LIKE 'character_set%';

-- 修改数据库字符集
ALTER DATABASE practice_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Docker 容器无法连接

如果使用 Docker，确保：
- 容器正在运行：`docker ps`
- 端口映射正确
- 网络配置正确

## 推荐配置

**开发环境**：使用 Docker Compose（最简单）

**生产环境**：
- 使用云数据库服务（更稳定）
- 或使用 Docker 部署（需要配置数据持久化）
- 配置数据库备份策略

