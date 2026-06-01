# ============================================
# 微信云托管 - 后端服务 Dockerfile
# ============================================
# BuildKit 并行构建 + 分层缓存，缩短部署时间：
#   DOCKER_BUILDKIT=1 docker build -t practice-hub-backend .

# syntax=docker/dockerfile:1

# 系统依赖（与 builder 并行构建，仅 Dockerfile 此段变更时重建）
FROM node:20-alpine AS runtime-base

RUN apk add --no-cache \
      ghostscript \
      poppler-utils \
      mupdf-tools \
      imagemagick \
      libreoffice-writer \
      font-wqy-zenhei \
      fontconfig \
    && fc-cache -f \
    && rm -rf /var/cache/apk/* /usr/share/man /usr/share/doc \
    && rm -rf /usr/lib/libreoffice/share/gallery \
    && rm -rf /usr/lib/libreoffice/share/template \
    && rm -rf /usr/lib/libreoffice/share/wizards

# 构建阶段：单次 npm ci → 编译 → prune 生产依赖（避免 prod-deps 二次安装）
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json .npmrc ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --prefer-offline

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

# 生产阶段
FROM runtime-base AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/src/assets ./src/assets

# nestjs 用户需对 /app 有写权限（multer 临时文件、分片上传等）
RUN mkdir -p /app/uploads/temp /app/uploads/pdf \
    && chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
