# ============================================
# 微信云托管 - 后端服务 Dockerfile
# ============================================
# 多阶段构建，优化镜像大小和构建速度

# 构建阶段
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装构建依赖（git 用于某些 npm 包）
RUN apk add --no-cache git

# 复制 package 文件（利用 Docker 缓存层）
COPY package*.json ./

# 安装依赖（包括 devDependencies，用于构建）
RUN npm ci --legacy-peer-deps

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 生产阶段
FROM node:20-alpine AS production

# 设置工作目录
WORKDIR /app

# 创建非 root 用户（安全最佳实践）
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --only=production --legacy-peer-deps && \
    npm cache clean --force

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist

# 复制必要的配置文件
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# 更改文件所有者
RUN chown -R nestjs:nodejs /app

# 切换到非 root 用户
USER nestjs

# 暴露端口（使用 8080 避免权限问题）
# 微信云托管会自动通过环境变量 PORT 配置端口
EXPOSE 8080

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=8080

# 健康检查（微信云托管会使用此检查服务状态）
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "dist/main.js"]

