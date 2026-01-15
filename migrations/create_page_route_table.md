# 页面路由表迁移说明

## 概述

本次迁移创建页面路由表，用于存储小程序的所有页面路径和标题信息，支持动态管理轮播图跳转等功能。

## 迁移步骤

### 1. 执行 SQL 脚本

```bash
# 进入后端容器
docker compose exec back-end bash

# 执行迁移脚本
mysql -h mysql -u root -p${MYSQL_ROOT_PASSWORD} ${MYSQL_DATABASE} < /app/migrations/create_page_route_table.sql
```

或者使用 docker compose：

```bash
docker compose exec mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} ${MYSQL_DATABASE} < back-end/migrations/create_page_route_table.sql
```

### 2. 同步页面路由

在小程序项目根目录（`font-end`）运行：

```bash
# 设置后端地址（如果需要）
export API_BASE_URL=http://localhost:3000

# 运行同步脚本
npm run sync-routes
```

或者直接运行：

```bash
node scripts/sync-page-routes.js
```

### 3. 验证同步结果

```sql
-- 检查表是否创建成功
SHOW TABLES LIKE 'page_route';

-- 检查页面路由数据
SELECT * FROM page_route ORDER BY type, path;

-- 检查各类型页面数量
SELECT type, COUNT(*) as count FROM page_route GROUP BY type;
```

## 表结构说明

### page_route（页面路由表）

- `id`: 主键
- `path`: 页面路径（唯一，如：/pages/index/index）
- `title`: 页面标题（如：首页）
- `type`: 页面类型（main-主包，sub-子包，tabBar-tabBar页面）
- `status`: 状态（0-禁用，1-启用）
- `create_time`: 创建时间
- `update_time`: 更新时间

## API 接口

### 同步页面路由（小程序端调用）

```
POST /api/app/page-routes/sync
```

无需权限验证，小程序端脚本调用。

### 获取页面路由列表（管理端）

```
GET /api/admin/page-routes?type=main&status=1
```

需要权限验证（SUPER_ADMIN 或 CONTENT_ADMIN）。

## 使用说明

1. **首次使用**：
   - 执行数据库迁移
   - 运行同步脚本上传页面路由

2. **更新页面路由**：
   - 修改 `pages.json` 后
   - 重新运行同步脚本
   - 脚本会自动创建新页面，更新已存在的页面

3. **管理端使用**：
   - 在轮播图配置中选择页面时
   - 会自动从数据库加载页面列表
   - 支持搜索和筛选

## 注意事项

1. 页面路径必须唯一
2. 同步脚本会自动识别页面类型（main/sub/tabBar）
3. 同步后的页面状态默认为"启用"
4. 如果页面路径已存在，会更新标题和类型
5. 建议在添加新页面后及时运行同步脚本

## 回滚

如果需要回滚，可以执行：

```sql
DROP TABLE IF EXISTS page_route;
```
