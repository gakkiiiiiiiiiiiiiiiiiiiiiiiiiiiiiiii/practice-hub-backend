# 快速导入数据库到外网服务器

这是一个一键导入脚本，可以从本地数据库直接导入到外网数据库。

## 快速开始

### 方法一：使用环境变量（推荐）

1. **配置远程数据库信息**

创建 `.env.remote` 文件或直接在 `.env` 中添加：

```env
# 远程数据库配置
REMOTE_DB_HOST=外网数据库地址
REMOTE_DB_PORT=3306
REMOTE_DB_USERNAME=用户名
REMOTE_DB_PASSWORD=密码
REMOTE_DB_DATABASE=practice_hub

# 本地数据库配置（如果与默认不同）
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=本地密码
DB_DATABASE=practice_hub
```

2. **执行导入**

```bash
cd back-end
npm run import:remote
```

### 方法二：使用命令行参数

```bash
npm run import:remote -- \
  --host=123.456.789.0 \
  --port=3306 \
  --user=root \
  --password=your_password \
  --database=practice_hub
```

### 方法三：临时设置环境变量

```bash
REMOTE_DB_HOST=123.456.789.0 \
REMOTE_DB_PORT=3306 \
REMOTE_DB_USERNAME=root \
REMOTE_DB_PASSWORD=your_password \
REMOTE_DB_DATABASE=practice_hub \
npm run import:remote
```

## 完整示例

假设外网数据库信息：
- 地址：`123.456.789.0`
- 端口：`3306`
- 用户名：`admin`
- 密码：`secure_password`
- 数据库：`practice_hub`

### 步骤 1：配置环境变量

编辑 `.env` 文件，添加：

```env
REMOTE_DB_HOST=123.456.789.0
REMOTE_DB_PORT=3306
REMOTE_DB_USERNAME=admin
REMOTE_DB_PASSWORD=secure_password
REMOTE_DB_DATABASE=practice_hub
```

### 步骤 2：执行导入

```bash
cd back-end
npm run import:remote
```

脚本会：
1. 连接本地数据库
2. 导出所有表结构和数据
3. 生成临时 SQL 文件
4. 连接外网数据库
5. 执行导入
6. 显示导入结果

## 导入方式选择

### 方式一：使用 TypeORM（默认，推荐）

不需要安装 mysql 命令行工具，使用 Node.js 直接导入：

```bash
npm run import:remote
```

### 方式二：使用 MySQL 命令行工具（更快）

如果系统已安装 mysql 命令行工具，可以使用：

```bash
USE_MYSQL_CLI=true npm run import:remote
```

或使用命令行参数：

```bash
npm run import:remote -- --mysql=true
```

## 命令行参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--host` | 外网数据库地址 | `--host=123.456.789.0` |
| `--port` | 数据库端口 | `--port=3306` |
| `--user` 或 `--username` | 数据库用户名 | `--user=root` |
| `--password` | 数据库密码 | `--password=xxx` |
| `--database` 或 `--db` | 数据库名 | `--database=practice_hub` |
| `--mysql` | 使用 mysql 命令行工具 | `--mysql=true` |

## 环境变量

### 远程数据库（必需）

```env
REMOTE_DB_HOST=外网数据库地址
REMOTE_DB_PORT=3306
REMOTE_DB_USERNAME=用户名
REMOTE_DB_PASSWORD=密码
REMOTE_DB_DATABASE=practice_hub
```

### 本地数据库（可选，使用默认值）

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=本地密码
DB_DATABASE=practice_hub
```

### 其他选项

```env
# 保留临时SQL文件（默认不保留）
KEEP_TEMP_FILE=true

# 使用 mysql 命令行工具导入（默认使用 TypeORM）
USE_MYSQL_CLI=true
```

## 导入流程

```
1. 连接本地数据库
   ↓
2. 导出所有表结构
   ↓
3. 导出所有表数据
   ↓
4. 生成 SQL 文件
   ↓
5. 连接外网数据库
   ↓
6. 执行 SQL 导入
   ↓
7. 显示导入结果
```

## 注意事项

### 1. 外网数据库访问

确保：
- ✅ 外网数据库允许远程访问
- ✅ 安全组/防火墙开放 3306 端口
- ✅ 数据库用户有远程访问权限

### 2. 数据安全

- ⚠️ 导入前会清空目标表（DROP TABLE IF EXISTS）
- ⚠️ 建议先备份外网数据库
- ⚠️ 不要在命令行中直接暴露密码（使用环境变量）

### 3. 网络连接

- 确保网络连接稳定
- 大文件导入可能需要较长时间
- 如果导入中断，可以重新运行（会重新生成 SQL 文件）

### 4. 权限要求

- 本地数据库：需要 SELECT 权限
- 外网数据库：需要 CREATE、DROP、INSERT 权限

## 故障排查

### 1. 连接失败

**错误**: `ECONNREFUSED` 或 `Access denied`

**解决**:
- 检查外网数据库地址和端口
- 检查用户名和密码
- 检查数据库是否允许远程访问
- 检查安全组/防火墙规则

### 2. 权限不足

**错误**: `Access denied for user`

**解决**:
- 确保用户有 CREATE、DROP、INSERT 权限
- 检查数据库用户权限设置

### 3. 表已存在

**错误**: `Table already exists`

**解决**:
- 这是正常的，脚本会先删除表再创建
- 如果仍有错误，检查是否有外键约束

### 4. 导入中断

**解决**:
- 重新运行脚本
- 脚本会重新生成 SQL 文件并导入

## 性能优化

### 1. 使用 MySQL 命令行工具

如果系统已安装 mysql 命令行工具，使用它导入会更快：

```bash
USE_MYSQL_CLI=true npm run import:remote
```

### 2. 分批导入

如果数据量很大，可以：
1. 先导出 SQL 文件：`npm run export:sql`
2. 手动分批导入 SQL 文件

### 3. 网络优化

- 如果可能，在服务器本地执行导入
- 使用压缩传输（如果支持）

## 验证导入结果

导入完成后，可以连接外网数据库验证：

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
```

## 示例输出

```
========================================
数据库导入到外网服务器
========================================

本地数据库: localhost:3306/practice_hub
远程数据库: 123.456.789.0:3306/practice_hub

正在连接本地数据库...
本地数据库连接成功

正在生成 SQL 文件...

正在导出表: sys_user...
  ✓ 表 sys_user 导出完成
正在导出表: app_user...
  ✓ 表 app_user 导出完成
...

✓ SQL文件已生成: /path/to/exports/temp_import.sql (2.5 MB)

正在导入到外网数据库...

数据库地址: 123.456.789.0:3306
数据库名: practice_hub
用户: admin

远程数据库连接成功

✓ 导入完成！成功: 150 条，失败: 0 条

========================================
✓ 导入完成！
========================================
```

## 安全建议

1. **密码安全**
   - 使用环境变量存储密码，不要硬编码
   - 不要将包含密码的文件提交到 Git
   - 使用 `.env` 文件并添加到 `.gitignore`

2. **网络安全**
   - 使用 SSL 连接（如果数据库支持）
   - 限制数据库访问 IP
   - 使用强密码

3. **备份**
   - 导入前备份外网数据库
   - 保留 SQL 文件作为备份

