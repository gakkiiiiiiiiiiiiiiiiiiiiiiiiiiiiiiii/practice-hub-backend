# 快速启动指南

## 前置要求

1. **Node.js** >= 16.x
2. **MySQL 8.0** 和 **Redis**（见下方启动方式）

## 方式一：使用 Docker（推荐）

### 安装 Docker

- **macOS**: 下载并安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Windows**: 下载并安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**: 
  ```bash
  # Ubuntu/Debian
  sudo apt update
  sudo apt install docker.io docker-compose-plugin
  sudo systemctl start docker
  sudo systemctl enable docker
  ```

### 启动数据库

```bash
cd back-end

# 新版本 Docker（推荐，使用 docker compose，没有横杠）
docker compose up -d

# 如果上面命令不行，尝试旧版本（使用 docker-compose，有横杠）
docker-compose up -d

# 检查是否启动成功
docker ps
```

如果看到 `practice_hub_mysql` 和 `practice_hub_redis` 两个容器在运行，说明启动成功。

## 方式二：本地安装 MySQL 和 Redis

### macOS

```bash
# 安装 MySQL
brew install mysql@8.0
brew services start mysql@8.0

# 安装 Redis
brew install redis
brew services start redis

# 创建数据库
mysql -u root -p
CREATE DATABASE practice_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Linux (Ubuntu/Debian)

```bash
# 安装 MySQL
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql

# 安装 Redis
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 创建数据库
sudo mysql -u root -p
CREATE DATABASE practice_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 配置项目

### 1. 安装依赖

```bash
cd back-end
npm install
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp env.example .env

# 编辑 .env 文件
# 如果使用 Docker，使用以下配置：
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=root123456
DB_DATABASE=practice_hub

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

JWT_SECRET=your_jwt_secret_key_change_this
JWT_EXPIRE=7d

WECHAT_APPID=your_wechat_appid
WECHAT_SECRET=your_wechat_secret

PORT=3000
NODE_ENV=development
```

### 3. 启动项目

```bash
# 开发模式（自动重启）
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

### 4. 访问 API 文档

浏览器打开：http://localhost:3000/api-docs

## 常见问题

### 1. docker-compose 命令找不到

**解决方案**：
- 新版本 Docker 使用：`docker compose`（没有横杠）
- 旧版本使用：`docker-compose`（有横杠）
- 如果都没有，需要安装 Docker Desktop

### 2. 端口被占用

如果 3306 或 6379 端口被占用：

```bash
# 修改 docker-compose.yml 中的端口映射
# 例如：将 3306 改为 3307
ports:
  - "3307:3306"  # 外部端口:容器内部端口
```

然后修改 `.env` 文件中的端口号。

### 3. MySQL 连接失败

检查：
1. MySQL 服务是否启动：`docker ps` 或 `brew services list`
2. 密码是否正确
3. 数据库是否创建

### 4. Redis 连接失败

检查：
1. Redis 服务是否启动：`docker ps` 或 `brew services list`
2. 端口是否正确

## 验证安装

### 测试 MySQL

```bash
mysql -h localhost -P 3306 -u root -p
# 输入密码后，应该能连接成功
```

### 测试 Redis

```bash
redis-cli
# 输入 ping，应该返回 PONG
```

### 测试项目

启动项目后，访问 http://localhost:3000，应该看到：
```
考研刷题小程序后端服务运行中...
```

## 下一步

1. 查看 API 文档：http://localhost:3000/api-docs
2. 阅读项目文档：`PROJECT_SUMMARY.md`
3. 开始开发！

