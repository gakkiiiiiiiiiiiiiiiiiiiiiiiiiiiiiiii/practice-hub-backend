# Process-PDF 模块

PDF/Word 题目提取，供管理端「试题管理 - JSON 导入」使用。

## 功能

- **PDF**：先按文本解析（pdf-parse）；若未提取到题目则按图片 PDF 处理，每页转图后走**硅基流动 OCR**（模型 `PaddlePaddle/PaddleOCR-VL-1.5`），再解析题目。
- **Word**：支持 `.docx`/`.doc`，使用 mammoth 转文本后按同一规则解析题目。

## 环境变量

- **SILICON_FLOW_API_KEY**：硅基流动 API Key。未配置时，图片型 PDF 将无法 OCR，仅可解析含可选中文字的 PDF。

## 部署依赖（图片 PDF / 强制 OCR）

- **Ghostscript (gs)**：PDF 转图依赖。Docker 镜像已在 Dockerfile 中通过 `apk add ghostscript` 安装；本地或其它环境需自行安装 `gs`，否则 OCR 路径会报错。

## 结构

- **core/extract-questions.ts**：提取逻辑，导出 `extractQuestions(pdfPath)`、`parseQuestionsFromText(text)`、`getPdfPageCount(pdfPath)`
- **silicon-flow-ocr.service.ts**：硅基流动 PaddleOCR-VL-1.5 单图 OCR
- **process-pdf.service.ts**：Nest 服务，PDF 文本/OCR 与 Word 解析
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

- `POST /admin/process-pdf/extract`（需管理员 JWT，表单字段 `pdf`）：PDF 提取，支持文本 PDF 与图片 PDF（OCR）
- `POST /admin/process-pdf/extract-doc`（需管理员 JWT，表单字段 `doc`）：Word（.docx/.doc）提取

## CLI

- `npm run parse:pdf <PDF路径> [输出路径]`（见根目录 `scripts/parse-pdf-to-excel.ts`）
