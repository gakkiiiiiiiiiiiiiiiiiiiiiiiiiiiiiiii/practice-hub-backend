# 考研刷题小程序 - 后端项目总结

## 项目概述

基于 NestJS 的后端服务，提供小程序端和管理后台的完整 API 支持。

## 技术栈

- **框架**: NestJS 10.x
- **数据库**: MySQL 8.0 + TypeORM
- **缓存**: Redis (ioredis)
- **认证**: JWT (Passport)
- **文档**: Swagger
- **文件处理**: ExcelJS (Excel 导入)

## 项目结构

```
back-end/
├── src/
│   ├── common/              # 公共模块
│   │   ├── decorators/      # 装饰器（CurrentUser, Roles）
│   │   ├── guards/          # 守卫（JWT, Roles）
│   │   ├── interceptors/    # 拦截器（操作日志）
│   │   ├── filters/         # 异常过滤器
│   │   ├── dto/            # 通用 DTO
│   │   └── redis/           # Redis 服务
│   ├── database/            # 数据库实体
│   │   ├── entities/       # 所有实体类
│   │   └── database.module.ts
│   ├── modules/             # 业务模块
│   │   ├── auth/           # 认证模块（小程序+管理后台）
│   │   ├── user/           # 用户模块（小程序端）
│   │   ├── home/           # 首页模块
│   │   ├── subject/        # 题库模块（小程序端）
│   │   ├── question/       # 题目模块（小程序端）
│   │   ├── wrong-book/     # 错题本模块
│   │   ├── collection/     # 收藏模块
│   │   ├── activation-code/# 激活码模块（小程序端）
│   │   ├── order/          # 订单模块
│   │   ├── admin/          # 管理员模块
│   │   ├── dashboard/     # 仪表盘模块
│   │   ├── system/         # 系统管理模块
│   │   ├── recommend/      # 首页推荐管理
│   │   ├── admin-subject/  # 管理后台-题库管理
│   │   ├── admin-question/ # 管理后台-题目管理
│   │   └── admin-activation-code/ # 管理后台-激活码管理
│   ├── app.module.ts       # 根模块
│   └── main.ts             # 入口文件
├── package.json
├── tsconfig.json
└── README.md
```

## 核心功能实现

### 1. 数据库实体

已创建所有必要的实体：
- `sys_user`: 后台管理员
- `app_user`: 小程序用户
- `subject`: 科目
- `chapter`: 章节/年份
- `question`: 题目
- `user_answer_log`: 答题流水
- `user_wrong_book`: 错题本
- `user_collection`: 收藏
- `user_subject_auth`: 已购题库记录
- `activation_code`: 激活码
- `order`: 订单
- `sys_operation_log`: 系统日志
- `home_recommend_category`: 推荐版块
- `home_recommend_item`: 推荐内容

### 2. 小程序端 API

#### 认证与用户
- `POST /api/app/auth/login` - 微信一键登录
- `GET /api/app/user/info` - 获取个人信息
- `PUT /api/app/user/profile` - 更新个人信息
- `POST /api/app/user/bind_phone` - 绑定手机号

#### 首页
- `GET /api/app/home/config` - 获取首页配置
- `GET /api/app/home/quote` - 获取每日励志语录
- `GET /api/app/home/layout` - 获取首页推荐布局

#### 题库
- `GET /api/app/subjects` - 所有题库列表
- `GET /api/app/subjects/:id/detail` - 题库详情

#### 题目
- `GET /api/app/questions/chapters/:id/questions` - 获取章节题目列表
- `GET /api/app/questions/:id` - 获取单题详情（需权限）
- `POST /api/app/questions/submit` - 提交答案
- `POST /api/app/questions/batch_submit` - 批量提交（试卷模式）

#### 学习工具
- `GET /api/app/wrong_book` - 获取错题列表
- `POST /api/app/wrong_book/remove` - 斩题
- `POST /api/app/favorite/toggle` - 收藏/取消收藏

#### 激活码与订单
- `POST /api/app/code/redeem` - 使用激活码（并发安全）
- `POST /api/app/order/create` - 创建预支付订单

### 3. 管理后台 API

#### 管理员认证
- `POST /api/admin/auth/login` - 账号密码登录
- `GET /api/admin/auth/info` - 获取当前管理员信息

#### 仪表盘
- `GET /api/admin/stats/overview` - 系统总览（SuperAdmin）
- `GET /api/admin/stats/agent` - 代理商数据（Agent）

#### 题库管理
- `POST /api/admin/subjects` - 新增/编辑科目
- `PUT /api/admin/subjects/:id` - 更新科目
- `GET /api/admin/subjects` - 获取科目列表

#### 题目管理
- `POST /api/admin/questions` - 新增/编辑题目
- `PUT /api/admin/questions/:id` - 更新题目
- `GET /api/admin/questions` - 题目列表（支持筛选）
- `POST /api/admin/questions/import` - 批量导入题目（Excel）

#### 激活码管理
- `POST /api/admin/codes/generate` - 生成激活码（Super/Agent）
- `GET /api/admin/codes` - 激活码列表（数据权限隔离）
- `GET /api/admin/codes/export` - 导出激活码

#### 系统管理
- `PUT /api/admin/settings/countdown` - 设置考研倒计时
- `GET /api/admin/logs` - 获取操作日志列表
- `PUT /api/admin/users/:id/status` - 封禁/解封用户

#### 首页推荐管理
- `GET /api/admin/recommend/categories` - 获取推荐版块列表
- `POST /api/admin/recommend/categories` - 创建版块
- `PUT /api/admin/recommend/categories/:id` - 更新版块
- `DELETE /api/admin/recommend/categories/:id` - 删除版块
- `POST /api/admin/recommend/items` - 添加题库到版块
- `DELETE /api/admin/recommend/items/:id` - 移除版块内的题库
- `PUT /api/admin/recommend/items/sort` - 调整排序

### 4. 核心业务逻辑

#### 激活码核销（并发安全）
- 使用数据库事务和乐观锁
- 通过 UPDATE 影响行数判断并发冲突
- 确保数据一致性

#### 题目导入
- 支持 Excel 格式
- 解析题型、选项、答案、解析等
- 支持 LaTeX 公式转义
- 异步批量插入

#### 数据权限隔离
- SuperAdmin: 查看所有数据
- Agent: 只能查看自己的激活码
- 在 SQL 查询中自动添加 WHERE 条件

#### 资源权限守卫
- 检查题库是否免费或 VIP 免费
- 验证用户是否已购买或使用激活码
- 检查权限是否过期
- 防止未授权访问

#### AOP 操作日志
- 自动记录增删改操作
- 记录操作者、模块、动作、目标ID等信息
- 通过拦截器实现

## 环境配置

1. 复制 `.env.example` 为 `.env`
2. 配置数据库连接信息
3. 配置 Redis 连接信息
4. 配置 JWT Secret
5. 配置微信小程序 AppID 和 Secret

## 启动项目

```bash
# 安装依赖
npm install

# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

## API 文档

启动服务后访问: `http://localhost:3000/api-docs`

## 注意事项

1. **数据库同步**: 开发环境会自动同步数据库结构，生产环境请使用迁移
2. **文件上传**: 题目导入功能需要配置 multer
3. **微信支付**: 订单创建接口需要对接微信支付 V3
4. **OSS 存储**: 图片上传功能需要配置 OSS
5. **权限控制**: 确保 JWT Token 正确传递，管理后台需要 Bearer Token

## 待完善功能

1. 微信支付回调处理
2. OSS 图片上传
3. 数据库迁移脚本
4. 单元测试
5. E2E 测试
6. 日志系统完善
7. 性能优化（缓存策略）

## 开发规范

- 使用 ES6+ 语法
- 保持函数单一职责
- 变量和函数命名语义化
- 复杂逻辑添加注释
- 优先使用 async/await
- 统一响应格式（CommonResponseDto）

