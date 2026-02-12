# Process-PDF 模块

PDF 题目提取（pdf-parse 本地解析），供管理端 API 与 CLI 使用。

## 结构

- **core/extract-questions.ts**：提取逻辑，导出 `extractQuestions(pdfPath)`
- **process-pdf.service.ts**：Nest 服务，供 `POST /admin/process-pdf/extract` 使用
- **server.ts**：独立 HTTP 服务（可选），`POST /upload`、`GET /health`
- **scripts/**：辅助脚本（如 check-stats.ts）
- **fixtures/**：示例 PDF（可选）
- **output/**：提取结果（如 extract.json），由脚本或 CLI 写入

## 运行独立服务

```bash
# 先构建
npm run build
npm run process-pdf:server
# 或：node dist/src/modules/process-pdf/server.js
```

或开发时：

```bash
npx ts-node -r tsconfig-paths/register src/modules/process-pdf/server.ts
```

服务地址：`http://localhost:3000`，表单字段 `pdf`。

## 主后端 API

- `POST /admin/process-pdf/extract`（需管理员 JWT，表单字段 `pdf`）

## CLI

- `npm run parse:pdf <PDF路径> [输出路径]`（见根目录 `scripts/parse-pdf-to-excel.ts`）
