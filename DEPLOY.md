# 微信云托管部署指南

## 前置准备

1. **环境变量配置**
   - 在微信云托管控制台配置环境变量
   - 参考 `env.example` 文件，设置以下必需的环境变量：
     - `DB_HOST`: 数据库地址
     - `DB_PORT`: 数据库端口（默认 3306）
     - `DB_USERNAME`: 数据库用户名
     - `DB_PASSWORD`: 数据库密码
     - `DB_DATABASE`: 数据库名称
     - `JWT_SECRET`: JWT 密钥（生产环境请使用强密钥）
     - `JWT_EXPIRE`: JWT 过期时间（默认 7d）
     - `WECHAT_APPID`: 微信小程序 AppID
     - `WECHAT_SECRET`: 微信小程序 Secret
     - `PORT`: 服务端口（默认 8080，微信云托管会自动配置）

2. **数据库准备**
   - 确保 MySQL 数据库已创建
   - 数据库表结构会在应用启动时自动同步（TypeORM）

## 部署步骤

### 方式一：通过微信云托管控制台部署

1. **创建服务**
   - 登录微信云托管控制台
   - 创建新服务，选择"代码部署"

2. **配置代码仓库**
   - 连接 GitHub/GitLab 仓库
   - 选择 `back-end` 目录
   - 选择分支（如 `master`）

3. **配置构建**
   - 构建方式：Dockerfile
   - Dockerfile 路径：`back-end/Dockerfile`
   - 构建命令：自动使用 Dockerfile

4. **配置环境变量**
   - 在服务配置中添加所有必需的环境变量
   - 参考 `env.example` 文件

5. **部署**
   - 点击"部署"按钮
   - 等待构建和部署完成

### 方式二：通过命令行部署

```bash
# 1. 安装微信云托管 CLI（如果还没有）
npm install -g @cloudbase/cli

# 2. 登录
tcb login

# 3. 初始化项目（在 back-end 目录下）
cd back-end
tcb init

# 4. 部署
tcb deploy
```

## 构建耗时优化

若部署/构建时间过长，可参考以下已做优化与建议：

1. **启用 BuildKit**（推荐）  
   Dockerfile 已使用 `RUN --mount=type=cache,target=/root/.npm` 缓存 npm 目录，**需开启 BuildKit 才能生效**：
   ```bash
   export DOCKER_BUILDKIT=1
   docker build -t practice-hub-backend:latest .
   ```
   微信云托管若使用 Docker 构建，请在构建环境中启用 BuildKit，以便复用 npm 缓存，二次构建会明显加快。

2. **已做修改**  
   - **bcrypt → bcryptjs**：去掉原生 C++ 编译，Alpine 下不再安装 build-base、拖慢构建。  
   - **npm 缓存挂载**：builder 与 production 阶段均使用缓存，未改 `package*.json` 时依赖安装会命中缓存。  
   - **`--prefer-offline --no-audit`**：减少网络与审计耗时。

3. **若仍很慢**  
   - 确认构建环境已开启 BuildKit。  
   - 检查网络：拉取 node:20-alpine 与 npm 包可能较慢，可配置镜像源。  
   - 首次构建会较慢，后续只改业务代码时主要重跑 `COPY . .` 和 `npm run build`，会快很多。

## 本地构建测试

在推送到微信云托管之前，可以在本地测试 Docker 镜像：

```bash
# 使用 BuildKit 构建（推荐，利用缓存）
export DOCKER_BUILDKIT=1
docker build -t practice-hub-backend:latest .

# 运行容器（需要配置环境变量）
docker run -d \
  -p 8080:8080 \
  -e DB_HOST=your_db_host \
  -e DB_PORT=3306 \
  -e DB_USERNAME=root \
  -e DB_PASSWORD=your_password \
  -e DB_DATABASE=practice_hub \
   -e JWT_SECRET=your_jwt_secret \
  -e WECHAT_APPID=your_appid \
  -e WECHAT_SECRET=your_secret \
  --name practice-hub-backend \
  practice-hub-backend:latest

# 查看日志
docker logs -f practice-hub-backend

# 停止容器
docker stop practice-hub-backend
docker rm practice-hub-backend
```

## 注意事项

1. **端口配置**
  - 应用默认使用 8080 端口（避免权限问题）
  - 应用会自动监听 `0.0.0.0:8080`
  - 可以通过环境变量 `PORT` 修改端口
  - 微信云托管控制台中的容器端口、Readiness Probe、Liveness Probe 都应配置为 `8080`
  - 微信云托管会自动处理外部访问映射，不需要应用监听 `80`

2. **数据库连接**
   - 确保数据库允许从微信云托管网络访问
   - 建议使用云数据库（如腾讯云 MySQL）
   - 配置安全组规则，允许微信云托管 IP 访问

3. **环境变量**
   - 不要在代码中硬编码敏感信息
   - 所有配置都通过环境变量传递
   - 生产环境使用强密钥

5. **健康检查**
   - Dockerfile 中已配置健康检查
   - 微信云托管会自动监控服务健康状态

6. **日志查看**
   - 在微信云托管控制台查看服务日志
   - 应用日志会输出到标准输出/错误流

## 故障排查

1. **服务无法启动**
   - 检查环境变量是否配置完整
   - 检查数据库和 Redis 连接是否正常
   - 查看服务日志

2. **数据库连接失败**
   - 检查数据库地址和端口
   - 检查数据库用户名和密码
   - 检查安全组规则

3. **端口冲突**
  - 确保容器内监听端口与云托管探针端口一致，推荐统一为 `8080`
  - 可以通过环境变量 `PORT` 修改端口

## 更新部署

代码更新后，在微信云托管控制台点击"重新部署"即可。

或者通过命令行：

```bash
cd back-end
tcb deploy
```
