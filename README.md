# 考研刷题小程序 - 后端服务

基于 NestJS 的后端服务，提供小程序端和管理后台的 API 支持。

## 技术栈

- **框架**: NestJS 10.x
- **数据库**: MySQL 8.0 + TypeORM
- **缓存**: Redis (ioredis)
- **认证**: JWT (Passport)
- **文档**: Swagger

## 快速开始

> 💡 **快速启动遇到问题？** 请查看 [QUICK_START.md](./QUICK_START.md) 获取详细步骤和常见问题解决方案。

### 安装依赖

```bash
npm install
```

### 启动数据库

本项目需要 MySQL 8.0 和 Redis。推荐使用 Docker 启动：

```bash
# 新版本 Docker（推荐，使用 docker compose，没有横杠）
docker compose up -d

# 如果上面命令不行，尝试旧版本（使用 docker-compose，有横杠）
docker-compose up -d

# 检查是否启动成功
docker ps
```

**如果没有 Docker**，请参考：
- [DATABASE_SETUP.md](./DATABASE_SETUP.md) - 详细的数据库安装和启动指南
- [QUICK_START.md](./QUICK_START.md) - 快速启动完整指南

### 配置环境变量

复制 `env.example` 为 `.env` 并填写配置：

```bash
cp env.example .env
```

然后编辑 `.env` 文件，填写以下配置：
- **数据库配置**：MySQL 连接信息
- **Redis 配置**：Redis 连接信息
- **JWT_SECRET**：JWT 密钥（生产环境请使用强密钥）
- **微信小程序配置**：AppID 和 Secret（用于小程序登录）
- **服务器配置**：端口号、环境变量等

### 运行项目

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

## 项目结构

```
src/
├── common/          # 公共模块
│   ├── decorators/  # 装饰器
│   ├── guards/      # 守卫
│   ├── interceptors/# 拦截器
│   └── filters/     # 异常过滤器
├── config/          # 配置文件
├── database/        # 数据库实体
├── modules/         # 业务模块
│   ├── auth/        # 认证模块
│   ├── user/        # 用户模块
│   ├── subject/     # 题库模块
│   ├── question/    # 题目模块
│   ├── order/       # 订单模块
│   └── ...
└── main.ts          # 入口文件
```

## API 文档

启动服务后访问: `http://localhost:3333/api-docs`

## 数据库迁移

使用 TypeORM 进行数据库迁移，具体命令待补充。

