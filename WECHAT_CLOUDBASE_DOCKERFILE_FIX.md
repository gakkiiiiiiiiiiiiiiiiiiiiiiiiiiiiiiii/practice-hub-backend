# 微信云托管 Dockerfile 路径配置指南

## 错误信息

```
ERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```

## 问题分析

微信云托管在构建时找不到 Dockerfile 文件，通常是因为：

1. **工作目录配置错误**：构建时的工作目录不是 `back-end`
2. **Dockerfile 路径配置错误**：Dockerfile 路径配置不正确
3. **代码仓库目录结构问题**：Dockerfile 不在预期的位置

## 解决方案

### 方案一：配置工作目录为 back-end（推荐）

在微信云托管控制台配置：

1. **进入服务配置**
   - 登录微信云托管控制台
   - 选择对应的服务
   - 进入"服务配置" → "构建配置"

2. **配置工作目录**
   ```
   工作目录: back-end
   Dockerfile 路径: Dockerfile
   ```

   或者如果 Dockerfile 在根目录：
   ```
   工作目录: .
   Dockerfile 路径: back-end/Dockerfile
   ```

### 方案二：将 Dockerfile 复制到根目录（临时方案）

如果无法配置工作目录，可以将 Dockerfile 复制到项目根目录：

```bash
# 在项目根目录创建 Dockerfile（指向 back-end）
cp back-end/Dockerfile ./Dockerfile
```

然后修改根目录的 Dockerfile，调整路径：

```dockerfile
# 修改工作目录和路径
WORKDIR /app/back-end

# 或者使用多阶段构建，从 back-end 目录构建
```

### 方案三：使用正确的代码仓库配置

1. **确认代码仓库结构**
   ```
   practice-hub/
   ├── back-end/
   │   ├── Dockerfile  ← Dockerfile 在这里
   │   ├── package.json
   │   └── src/
   ├── admin-web/
   └── font-end/
   ```

2. **配置代码仓库**
   - 代码仓库：选择整个仓库
   - 工作目录：`back-end`
   - Dockerfile 路径：`Dockerfile`（相对于工作目录）

## 微信云托管配置示例

### 配置 1：工作目录方式（推荐）

```
代码仓库: https://github.com/xxx/practice-hub-backend.git
分支: master
工作目录: .  (如果 Dockerfile 在仓库根目录)
Dockerfile 路径: Dockerfile
```

### 配置 2：子目录方式

```
代码仓库: https://github.com/xxx/practice-hub.git
分支: master
工作目录: back-end
Dockerfile 路径: Dockerfile
```

### 配置 3：完整路径方式

```
代码仓库: https://github.com/xxx/practice-hub.git
分支: master
工作目录: .
Dockerfile 路径: back-end/Dockerfile
```

## 验证 Dockerfile 位置

### 方法 1：检查文件是否存在

```bash
# 在项目根目录
ls -la back-end/Dockerfile

# 应该显示：
# -rw-r--r--  1 user  staff  1234 Dec 23 16:00 back-end/Dockerfile
```

### 方法 2：检查 Git 仓库

```bash
# 确认 Dockerfile 已提交到 Git
git ls-files | grep Dockerfile

# 应该显示：
# back-end/Dockerfile
```

### 方法 3：检查构建上下文

在 Dockerfile 中添加调试信息（临时）：

```dockerfile
# 在 Dockerfile 开头添加
RUN ls -la
RUN pwd
```

## 常见配置错误

### 错误 1：工作目录为空

**配置**：
```
工作目录: (空)
Dockerfile 路径: Dockerfile
```

**问题**：如果代码仓库根目录没有 Dockerfile，会找不到文件

**解决**：设置工作目录为 `back-end`

### 错误 2：Dockerfile 路径错误

**配置**：
```
工作目录: .
Dockerfile 路径: Dockerfile
```

**问题**：如果 Dockerfile 在 `back-end` 目录，路径应该是 `back-end/Dockerfile`

**解决**：使用 `back-end/Dockerfile` 或设置工作目录为 `back-end`

### 错误 3：代码仓库选择错误

**问题**：选择了错误的代码仓库或分支

**解决**：
- 确认代码仓库 URL 正确
- 确认分支名称正确（如 `master`）
- 确认 Dockerfile 已提交到该分支

## 推荐的配置方式

### 如果 Dockerfile 在 back-end 目录

**最佳配置**：
```
代码仓库: https://github.com/xxx/practice-hub-backend.git
分支: master
工作目录: .
Dockerfile 路径: Dockerfile
```

**或者**（如果使用 monorepo）：
```
代码仓库: https://github.com/xxx/practice-hub.git
分支: master
工作目录: back-end
Dockerfile 路径: Dockerfile
```

## 检查清单

部署前检查：

- [ ] Dockerfile 文件存在
- [ ] Dockerfile 已提交到 Git
- [ ] 工作目录配置正确
- [ ] Dockerfile 路径配置正确
- [ ] 代码仓库和分支正确
- [ ] 构建日志中没有路径错误

## 调试步骤

### 1. 查看构建日志

在微信云托管控制台查看构建日志，确认：
- 工作目录是什么
- Dockerfile 路径是什么
- 文件是否存在

### 2. 本地测试构建

在本地测试 Dockerfile 是否能正常构建：

```bash
cd back-end
docker build -t test-build .
```

### 3. 检查文件权限

确保 Dockerfile 有读取权限：

```bash
ls -la back-end/Dockerfile
chmod 644 back-end/Dockerfile
```

## 快速修复

### 如果使用独立的 back-end 仓库

1. 确认 Dockerfile 在仓库根目录
2. 配置：
   ```
   工作目录: .
   Dockerfile 路径: Dockerfile
   ```

### 如果使用 monorepo

1. 确认 Dockerfile 在 `back-end` 目录
2. 配置：
   ```
   工作目录: back-end
   Dockerfile 路径: Dockerfile
   ```

## 联系支持

如果问题仍然存在：

1. 提供代码仓库结构截图
2. 提供 Dockerfile 位置
3. 提供微信云托管配置截图
4. 提供完整的构建日志
5. 联系微信云托管技术支持

