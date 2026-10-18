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

# 编译阶段：源码变化时只重编译，不再改写最终镜像使用的 node_modules
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json .npmrc ./

RUN --mount=type=cache,id=practice-hub-npm,target=/root/.npm,sharing=shared \
    npm ci --legacy-peer-deps --prefer-offline

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build

# 生产依赖独立分层：仅 package-lock.json 变化时才重新安装。
# 该阶段可与源码编译、系统依赖安装并行执行。
FROM node:20-alpine AS production-deps

WORKDIR /app

COPY package*.json .npmrc ./

RUN --mount=type=cache,id=practice-hub-npm,target=/root/.npm,sharing=shared \
    npm ci --omit=dev --legacy-peer-deps --prefer-offline

# 生产阶段
FROM runtime-base AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs \
    && adduser -S nestjs -u 1001 \
    && mkdir -p /app/uploads/temp /app/uploads/pdf \
    && chown -R nestjs:nodejs /app/uploads

COPY --from=production-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=production-deps --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/src/assets ./src/assets

USER nestjs

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
