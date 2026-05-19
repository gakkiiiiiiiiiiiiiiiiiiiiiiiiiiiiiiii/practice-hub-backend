# ============================================
# 微信云托管 - 后端服务 Dockerfile
# ============================================
# 使用 BuildKit 加速：DOCKER_BUILDKIT=1 docker build ...
# 多阶段构建，利用缓存层减少部署时长

# syntax=docker/dockerfile:1
# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 仅安装 git（部分 npm 包可选依赖需要）
RUN apk add --no-cache git

# 先复制依赖描述，利用缓存：未改 package 时跳过整层
COPY package*.json ./

# 使用 BuildKit 缓存 npm 目录，二次构建时大幅加速
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --prefer-offline --no-audit

COPY . .

RUN npm run build

# 生产阶段
FROM node:20-alpine AS production

# PDF 转图 / OCR 依赖：
# - pdf2pic@3.x 依赖 GraphicsMagick + Ghostscript
# - poppler-utils/pdftoppm 作为线上 PDF 转图主兜底
# - ImageMagick 作为线上容器中 GraphicsMagick 返回空结果时的兜底
# - 缺少 gm 时，课程文件单页预览接口会在云托管中转图失败
RUN apk add --no-cache graphicsmagick ghostscript poppler-utils imagemagick

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY package*.json ./

# 生产依赖也使用缓存；bcrypt 已换 bcryptjs，无原生编译
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --legacy-peer-deps --prefer-offline --no-audit && \
    npm cache clean --force

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist

# 虚拟支付内置商品图（微信拉取 item_url 兜底）
COPY --from=builder /app/src/assets ./src/assets

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
