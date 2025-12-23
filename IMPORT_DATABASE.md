# 快速导入数据库到外网服务器

本文档提供多种方式将数据库表和数据快速导入到外网数据库。

## 方式一：使用 SQL 文件导入（推荐，最快）

### 1. 导出 SQL 文件

在本地数据库导出 SQL 文件：

```bash
cd back-end
npm run export:sql
```

这会生成 `exports/database_export.sql` 文件，包含所有表结构和数据。

### 2. 导入到外网数据库

#### 方法 A：使用命令行（推荐）

```bash
# 使用 mysql 命令行工具
mysql -h 外网数据库地址 -P 端口 -u 用户名 -p 数据库名 < exports/database_export.sql

# 示例：
mysql -h 123.456.789.0 -P 3306 -u root -p practice_hub < exports/database_export.sql
```

#### 方法 B：使用 MySQL Workbench

1. 打开 MySQL Workbench
2. 连接到外网数据库
3. 文件 → 运行 SQL 脚本
4. 选择 `database_export.sql` 文件
5. 执行

#### 方法 C：使用 Navicat / DBeaver

1. 连接到外网数据库
2. 打开 SQL 文件
3. 执行

### 3. 配置外网数据库连接

如果需要通过脚本导入，创建 `.env.target` 文件：

```env
TARGET_DB_HOST=外网数据库地址
TARGET_DB_PORT=3306
TARGET_DB_USERNAME=用户名
TARGET_DB_PASSWORD=密码
TARGET_DB_DATABASE=practice_hub
```

然后使用脚本导入：

```bash
# 修改导入脚本使用目标数据库配置
TARGET_DB_HOST=外网地址 TARGET_DB_PORT=3306 TARGET_DB_USERNAME=用户名 TARGET_DB_PASSWORD=密码 npm run import:sql
```

## 方式二：使用 CSV 文件导入

### 1. 导出 CSV 文件

```bash
cd back-end
npm run export:csv
```

### 2. 配置目标数据库

创建 `.env.target` 文件或设置环境变量：

```env
TARGET_DB_HOST=外网数据库地址
TARGET_DB_PORT=3306
TARGET_DB_USERNAME=用户名
TARGET_DB_PASSWORD=密码
TARGET_DB_DATABASE=practice_hub
```

### 3. 导入 CSV

```bash
# 导入所有CSV文件
npm run import:csv

# 或指定CSV目录
npm run import:csv /path/to/csv/directory

# 严格模式（遇到错误停止）
npm run import:csv -- --strict
```

### 4. 清空表后导入（可选）

如果需要在导入前清空表：

```bash
CLEAR_TABLE=true npm run import:csv
```

## 方式三：使用 mysqldump（最灵活）

### 1. 导出数据库

```bash
# 导出表结构和数据
mysqldump -h 本地数据库地址 -u 用户名 -p 数据库名 > database_dump.sql

# 只导出数据（不包含表结构）
mysqldump -h 本地数据库地址 -u 用户名 -p --no-create-info 数据库名 > data_only.sql

# 只导出表结构（不包含数据）
mysqldump -h 本地数据库地址 -u 用户名 -p --no-data 数据库名 > structure_only.sql
```

### 2. 导入到外网数据库

```bash
mysql -h 外网数据库地址 -P 端口 -u 用户名 -p 数据库名 < database_dump.sql
```

## 方式四：使用 TypeORM 同步（自动创建表结构）

### 1. 配置外网数据库连接

修改 `.env` 文件或创建 `.env.production`：

```env
DB_HOST=外网数据库地址
DB_PORT=3306
DB_USERNAME=用户名
DB_PASSWORD=密码
DB_DATABASE=practice_hub
NODE_ENV=production
```

### 2. 启动应用（自动同步表结构）

```bash
# 开发环境会自动同步表结构
NODE_ENV=development npm run start:dev
```

**注意**：生产环境不建议使用 `synchronize: true`，应该使用迁移或手动导入。

## 快速导入步骤（推荐流程）

### 步骤 1：导出 SQL 文件

```bash
cd back-end
npm run export:sql
```

### 步骤 2：上传 SQL 文件到服务器

```bash
# 使用 scp 上传
scp exports/database_export.sql user@server:/tmp/

# 或使用其他方式（FTP、云存储等）
```

### 步骤 3：在服务器上导入

```bash
# SSH 连接到服务器
ssh user@server

# 导入 SQL 文件
mysql -h localhost -u root -p practice_hub < /tmp/database_export.sql
```

## 环境变量说明

### 源数据库（导出）

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=本地密码
DB_DATABASE=practice_hub
```

### 目标数据库（导入）

```env
TARGET_DB_HOST=外网数据库地址
TARGET_DB_PORT=3306
TARGET_DB_USERNAME=用户名
TARGET_DB_PASSWORD=密码
TARGET_DB_DATABASE=practice_hub
```

## 常见问题

### 1. 外网数据库连接失败

**错误**: `ECONNREFUSED` 或 `Access denied`

**解决**:
- 检查数据库是否允许外网访问
- 检查安全组/防火墙规则
- 检查数据库用户是否有远程访问权限
- 确认数据库地址和端口正确

### 2. 导入时外键约束错误

**错误**: `Cannot add or update a child row: a foreign key constraint fails`

**解决**:
- SQL 文件已包含 `SET FOREIGN_KEY_CHECKS=0;`
- 如果手动导入，先执行：`SET FOREIGN_KEY_CHECKS=0;`
- 导入完成后执行：`SET FOREIGN_KEY_CHECKS=1;`

### 3. 字符集问题

**错误**: 中文乱码

**解决**:
- 确保数据库使用 `utf8mb4` 字符集
- SQL 文件已包含 `SET NAMES utf8mb4;`
- 检查数据库和表的字符集设置

### 4. 大文件导入超时

**解决**:
- 增加 MySQL 超时设置：
  ```sql
  SET SESSION max_execution_time = 0;
  SET SESSION interactive_timeout = 3600;
  SET SESSION wait_timeout = 3600;
  ```
- 或使用命令行参数：
  ```bash
  mysql --max_allowed_packet=512M -h ... < database_export.sql
  ```

### 5. CSV 导入时数据类型错误

**解决**:
- 检查 CSV 文件格式是否正确
- 确保日期格式为 `YYYY-MM-DD HH:mm:ss`
- JSON 字段应为有效的 JSON 字符串

## 性能优化建议

1. **大文件导入**
   - 使用 SQL 文件导入（比 CSV 快）
   - 关闭索引检查：`SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0;`
   - 导入后重建索引

2. **网络优化**
   - 如果可能，在服务器本地执行导入
   - 使用压缩传输：`gzip` 压缩 SQL 文件

3. **分批导入**
   - 如果数据量很大，可以分批导入
   - 使用 `--where` 条件导出部分数据

## 验证导入结果

```sql
-- 检查表数量
SELECT COUNT(*) as table_count 
FROM information_schema.tables 
WHERE table_schema = 'practice_hub';

-- 检查各表记录数
SELECT 
  table_name,
  table_rows
FROM information_schema.tables
WHERE table_schema = 'practice_hub'
ORDER BY table_name;

-- 检查特定表的数据
SELECT COUNT(*) FROM sys_user;
SELECT COUNT(*) FROM question;
```

## 安全建议

1. **密码安全**
   - 不要在命令行中直接输入密码
   - 使用 `.env` 文件存储敏感信息
   - 不要将 `.env` 文件提交到 Git

2. **网络安全**
   - 使用 SSL 连接（如果支持）
   - 限制数据库访问 IP
   - 使用强密码

3. **备份**
   - 导入前备份目标数据库
   - 保留原始 SQL/CSV 文件

