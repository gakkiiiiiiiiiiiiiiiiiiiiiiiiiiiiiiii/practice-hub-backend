# PDF题目解析脚本使用说明

## 功能说明

这个脚本用于解析PDF文档，提取其中的题目、答案信息，并根据题目导入模板生成Excel文件。

## 主要功能

1. **PDF解析**：智能解析PDF文件，优先使用文本提取（无需额外依赖），失败时自动切换到OCR
2. **文本提取**：使用pdfjs-dist直接提取PDF文本（兼容性最好，速度最快）
3. **OCR识别**：当文本提取失败时，使用硅基流动的PaddleOCR-VL模型识别图片中的文字
4. **AI提取**：使用AI模型从文本中提取题目、选项、答案和解析信息
5. **Excel生成**：根据系统题目导入模板格式生成Excel文件

## 安装依赖

在运行脚本之前，需要先安装必要的依赖：

```bash
cd back-end
npm install
```

主要依赖包括：
- `pdfjs-dist`: PDF解析库（核心，始终可用）
- `pdf2pic`: PDF转图片库（可选，用于OCR场景，需要系统安装poppler）
- `exceljs`: Excel文件生成库
- `axios`: HTTP请求库
- `dotenv`: 环境变量加载（通常已包含在项目中）

## 环境变量配置

脚本需要配置硅基流动 API 的相关环境变量。请在 `back-end/.env` 文件中添加以下配置：

```bash
# 硅基流动 API 配置
SILICONFLOW_API_KEY=your_api_key_here
SILICONFLOW_API_BASE=https://api.siliconflow.cn/v1
OCR_MODEL=PaddlePaddle/PaddleOCR-VL
AI_MODEL=deepseek-ai/DeepSeek-R1-0528-Qwen3-8B
```

**环境变量说明：**
- `SILICONFLOW_API_KEY`（必需）：硅基流动 API 密钥
  - 也可以使用 `SF_API_KEY` 作为别名
- `SILICONFLOW_API_BASE`（可选）：API 基础地址，默认为 `https://api.siliconflow.cn/v1`
  - 也可以使用 `SF_API_BASE` 作为别名
- `OCR_MODEL`（可选）：OCR 识别模型，默认为 `PaddlePaddle/PaddleOCR-VL`
  - 也可以使用 `SF_OCR_MODEL` 作为别名
- `AI_MODEL`（可选）：AI 题目提取模型，默认为 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`
  - 也可以使用 `SF_AI_MODEL` 作为别名

**注意：** 
- 如果未设置 `SILICONFLOW_API_KEY`，脚本在调用 API 时会提示错误并退出
- 如果只是从 JSON 文件生成 Excel（使用 `--json` 参数），则不需要设置 API 配置
- 所有配置项都支持别名（如 `SF_API_KEY`），方便使用

**兼容性说明**：
- **文本提取模式**（默认）：仅需 `pdfjs-dist`，无需额外系统依赖，兼容性最好
- **OCR模式**：需要 `pdf2pic` 或 `canvas`（二选一即可）
  - `pdf2pic`：需要系统安装 poppler 工具（推荐）
  - `canvas`：需要系统级图形库（Cairo、Pango等）

## 使用方法

### 基本用法

```bash
npm run parse:pdf <PDF文件路径>
```

### 指定输出文件

```bash
npm run parse:pdf <PDF文件路径> <输出Excel路径>
```

### 强制使用OCR

```bash
npm run parse:pdf <PDF文件路径> --ocr
# 或
npm run parse:pdf <PDF文件路径> -o
```

### 示例

```bash
# 使用相对路径
npm run parse:pdf ../Downloads/《马克思主义基本原理》配套题库【考研真题精选＋章节题库】.pdf

# 使用绝对路径
npm run parse:pdf /Users/pangyujie/Downloads/《马克思主义基本原理》配套题库【考研真题精选＋章节题库】.pdf

# 指定输出文件
npm run parse:pdf input.pdf output.xlsx
```

## 工作流程

### 模式1：文本提取模式（默认，推荐）

1. **PDF解析阶段**
   - 读取PDF文件
   - 使用pdfjs-dist直接提取每页文本内容
   - 无需图片转换，速度最快，兼容性最好

2. **AI提取阶段**
   - 将所有页面的文本合并
   - 使用DeepSeek-V2.5模型提取题目信息
   - 自动识别题目类型（单选、多选、判断、填空、简答、阅读理解）
   - 提取题干、选项、答案、解析等信息

3. **Excel生成阶段**
   - 根据系统题目导入模板格式生成Excel文件
   - 包含表头：题型、题干、选项A、选项B、选项C、选项D、答案、解析
   - 应用格式和样式

### 模式2：OCR识别模式（备用）

当文本提取失败或内容不足时，自动切换到OCR模式：

1. **PDF转图片阶段**
   - 优先使用pdf2pic（需要poppler）将PDF页面转换为PNG图片
   - 如果pdf2pic不可用，尝试使用canvas库
   - 显示处理进度

2. **OCR识别阶段**
   - 将每页图片转换为Base64编码
   - 调用硅基流动的PaddleOCR-VL API进行OCR识别
   - 获取每页的文本内容
   - 每页处理间隔1秒，避免API调用过快

3. **AI提取阶段**（同模式1）

4. **Excel生成阶段**（同模式1）

## 输出格式

生成的Excel文件符合系统题目导入模板格式：

| 题型 | 题干 | 选项A | 选项B | 选项C | 选项D | 答案 | 解析 |
|------|------|-------|-------|-------|-------|------|------|
| 单选 | 题目内容 | 选项A内容 | 选项B内容 | 选项C内容 | 选项D内容 | A | 解析内容 |
| 多选 | 题目内容 | 选项A内容 | 选项B内容 | 选项C内容 | 选项D内容 | A,B | 解析内容 |
| 判断 | 题目内容 | 正确 | 错误 | | | A | 解析内容 |
| 填空 | 题目内容 | | | | | 答案内容 | 解析内容 |

## 注意事项

1. **兼容性优势**
   - **默认使用文本提取模式**：无需任何额外系统依赖，兼容性最好
   - 仅当文本提取失败时，才会切换到OCR模式
   - 文本提取模式速度最快，无需调用OCR API

2. **API限制**（仅OCR模式）
   - 脚本使用硅基流动API，需要确保API密钥有效
   - 每页处理间隔1秒，避免触发API速率限制
   - 如果PDF页数较多，处理时间会较长

3. **识别准确率**
   - 文本提取模式：准确率最高，完全保留原始格式
   - OCR识别模式：准确率取决于PDF质量（扫描质量、清晰度等）
   - AI提取准确率取决于文本质量和题目格式规范性
   - 建议在生成Excel后人工检查并修正

4. **题目格式要求**
   - PDF中的题目应具有清晰的格式（题目编号、选项标记等）
   - 答案和解析应明确标注（如"答案："、"解析："等）
   - 不规范的格式可能影响提取准确率

5. **错误处理**
   - 如果文本提取失败，自动切换到OCR模式
   - 如果某页OCR失败，会跳过该页并继续处理
   - 如果AI提取失败，会使用简单的文本解析作为备用方案
   - 所有错误都会在控制台输出

6. **系统要求**
   - 需要安装Node.js（建议v16+）
   - **文本提取模式**：无需额外系统依赖（推荐）
   - **OCR模式**（可选）：
     - 推荐：安装 `pdf2pic` + 系统安装 poppler
       - macOS: `brew install poppler`
       - Linux: `sudo apt-get install poppler-utils`
       - Windows: 下载 poppler 并添加到 PATH
     - 备用：安装 `canvas`（需要系统级图形库）
       - macOS: 通常已内置支持
       - Linux: `sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
       - Windows: 可能需要安装 `windows-build-tools`

## 故障排除

### 问题1: 文本提取模式无法提取文本

**原因**：PDF可能是扫描版或图片型PDF

**解决方案**：
- 使用 `--ocr` 参数强制使用OCR模式
- 确保安装了 `pdf2pic` 或 `canvas` 库

### 问题2: pdf2pic或canvas库不可用（仅OCR模式需要）

**解决方案**：
- **推荐方案**：安装 pdf2pic + poppler
  ```bash
  npm install pdf2pic
  # macOS
  brew install poppler
  # Linux
  sudo apt-get install poppler-utils
  ```
- **备用方案**：安装 canvas（需要系统图形库）
  ```bash
  npm install canvas
  # Linux系统依赖
  sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ```
- **最佳方案**：使用文本提取模式（默认），无需额外依赖

### 问题3: OCR API调用失败

**可能原因**：
- API密钥无效或过期
- 网络连接问题
- API服务暂时不可用

**解决方案**：
- 检查API密钥是否正确
- 检查网络连接
- 稍后重试

### 问题4: AI提取结果不准确

**可能原因**：
- OCR识别文本质量差
- PDF格式不规范
- 题目格式不统一

**解决方案**：
- 使用更清晰的PDF文件
- 在生成Excel后人工检查和修正
- 可以多次运行脚本，选择最佳结果

### 问题5: 内存不足

**可能原因**：
- PDF文件过大或页数过多

**解决方案**：
- 分批处理PDF（将PDF拆分为多个小文件）
- 增加Node.js内存限制：`node --max-old-space-size=4096`

## 技术细节

- **PDF解析**: 使用pdfjs-dist库（纯JavaScript，无需系统依赖）
- **文本提取**: pdfjs-dist内置文本提取功能（默认模式，兼容性最好）
- **图片转换**（OCR模式）:
  - 优先：pdf2pic + poppler（系统工具，兼容性好）
  - 备用：canvas库（需要系统图形库）
- **OCR识别**: 硅基流动 PaddleOCR-VL模型（仅OCR模式需要）
- **AI提取**: 硅基流动 DeepSeek-V2.5模型
- **Excel生成**: 使用exceljs库，符合系统导入模板格式

## 许可证

MIT
