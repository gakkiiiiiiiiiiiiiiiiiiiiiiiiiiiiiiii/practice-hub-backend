# 知页试卷预览与整卷打印

该模块只读取服务端配置的官方资料目录，不接受客户端 URL、文件路径或上传内容。

## 配置

设置 `ZHIYE_MATERIALS_ROOT` 为知页 `public/data/official` 的部署目录。目录必须包含：

- `materials.json`
- `files/` 中由目录记录引用的原始资料

单份原稿上限为 50MB。首期只支持 PDF；DOC、DOCX、ZIP 和 HTML 会在详情中返回
`printable: false` 及原因。目录与文件均从本地磁盘按 ID 定位，不会访问第三方网络，
也没有定时扫描任务。

## API

- `GET /api/app/zhiye-materials/:id`：公开详情，只返回
  `id/title/pageCount/previewPageCount/printable/reason`，不返回文件地址。
- `GET /api/app/zhiye-materials/:id/preview`：公开返回一个只包含实际前
  `min(3, pageCount)` 页的 PDF，响应中不包含整份原稿地址。
- `POST /api/app/zhiye-materials/:id/print-draft`：要求知页小程序 JWT，使用完整原稿
  调用现有打印草稿服务。返回 `{ draft, material }`；后续报价、地址、支付和订单仍沿用
  `/api/app/zhiye-print` 流程。

目录每 30 秒按 `materials.json` 文件状态惰性刷新；单份文件只在访问时校验路径、
普通文件类型、大小、SHA-256 和 PDF 页数。前三页预览限制 2 个并发任务，内存缓存总量
不超过 32MB，且原稿状态变化会使对应缓存失效。
