# 微信云托管：请求体大小限制（413 处理）

## 现象

调用 `POST /api/admin/process-pdf/extract` 或其它上传/大 JSON 接口时返回 **413 Request Entity Too Large**。

## 413 排查清单（按请求经过顺序）

| 层级 | 配置项 | 本项目当前值 | 说明 |
|------|--------|--------------|------|
| **1. 管理端 Nginx**（若前端通过 Nginx 代理 `/api` 到后端） | `client_max_body_size` | 默认 **1MB**，未设置时大文件必 413 | 在 `admin-web/nginx.conf` 的 server 或 `location /api` 中已设为 `100m` |
| **2. 云网关**（微信云托管/腾讯云接入层） | 请求体/上传大小 | 约 **20MB**（以控制台为准） | 请求先经网关，超过即 413，需在控制台调大或走「先传存储再传 URL」 |
| **3. 后端 Nest** | `main.ts` 的 `BODY_LIMIT` | `200mb`（仅对 JSON/urlencoded 有效） | 对 multipart 无效，multipart 由 Multer 限制 |
| **4. 后端 Multer** | `process-pdf.controller` 的 `fileSize` | **100MB** | 仅对已进入容器的请求生效 |

结论：**多数 413 来自 1（Nginx 未设）或 2（云网关）**。先确认管理端 Nginx 已设 `client_max_body_size 100m` 并重载；若仍 413 且文件 &lt; 20MB，再查后端与 Multer。

## 原因（云托管场景）

请求在到达你的 Node 应用之前，会先经过**微信云托管/腾讯云的接入层（网关）**。该层对单次请求体有默认大小限制（腾讯云托管文档中曾写为约 **20MB**），超过即直接返回 413，请求不会进入容器。

应用内已做的配置（如 `main.ts` 的 `BODY_LIMIT`、Multer 的 `fileSize`）只对**已进入容器的请求**生效，无法放宽网关限制。

## 在微信云托管中如何尝试调整

### 1. 控制台是否有配置项

1. 登录 [微信云托管控制台](https://cloud.weixin.qq.com/cloudrun)。
2. 进入对应 **环境** → 选择你的 **服务**。
3. 查看 **服务配置** / **版本配置** / **网关/路由/高级配置** 等菜单。
4. 查找与 **请求体大小**、**上传大小**、**body size**、**max request size** 相关的选项。
5. 若有，可尝试设置为 **50MB** 或你需要的值，保存后重新发布或等待生效。

目前官方文档未明确写出该配置的入口，界面可能随版本更新，以控制台实际为准。

### 2. 通过自定义网关/负载均衡（若开放）

若环境提供「自定义网关」、Nginx 配置或负载均衡策略，可在该层增加类似配置：

```nginx
client_max_body_size 50m;
```

仅当控制台或文档提供此类能力时可用。

### 3. 联系微信/腾讯云支持

若控制台没有请求体/上传大小配置：

- 在 [微信开放社区](https://developers.weixin.qq.com/community/minihome) 的「微信云托管」专区发帖询问：**如何调大单次请求体/上传文件大小限制**。
- 或通过腾讯云工单/客服咨询：当前环境是否支持调大请求体限制，以及具体配置路径。

## 应用内已做配置（供参考）

以下仅对**已进入容器的请求**有效，无法解决网关 413：

- **main.ts**：`express.json` / `express.urlencoded` 的 `limit` 使用环境变量 `BODY_LIMIT`，默认 `200mb`。
- **process-pdf.controller**：PDF 上传 Multer `fileSize` 为 **100MB**（与 Nginx `client_max_body_size 100m` 对齐）。

## 已实现：课程文件上传（大文件分片 + 小文件直传）

**大文件（>5MB）**：前端按 5MB 分片，依次请求 `POST /admin/upload/course-file-chunk` 上传分片，再请求 `POST /admin/upload/course-file-merge` 由服务端合并并落盘/COS，返回 fileUrl。单次请求体小，可规避网关 413。

**小文件**：仍可采用「先取凭证、再直传 COS」或单次 POST `/admin/upload/course-file`。

**直传 COS 流程**（小文件或未启用分片时）：

1. 管理端选择文件后，先请求后端 `POST /admin/upload/course-file-upload-url`（仅传 `fileName`，请求体极小，不会 413）。
2. 后端在云托管内调用 [tcb/uploadfile](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/storage/service/upload.html) 获取上传链接与凭证，返回给前端。
3. 前端将文件 **直接 POST 到凭证中的 COS URL**，不经过云托管网关，故无 body 限制。
4. 上传成功后使用返回的 `finalFileUrl` 作为课程文件地址保存。

**环境**：云托管一般会自动注入 `CBR_ENV_ID`；若未注入，可在环境变量中配置 `TCB_ENV_ID`（如 `prod-6g7tpqs40c5a758b`，与 COS_BUCKET 中间段一致）。  
**CORS**：若浏览器直传 COS 时报跨域，请在 [对象存储-配置](https://cloud.weixin.qq.com/cloudrun/storage) 中将管理端所在域名加入安全域名 / CORS 允许来源。

**错误 85107（URL 不在白名单）**：  
- 方案 A：在 **微信云托管控制台 → 服务管理 → 云调用 → 微信令牌** 的权限配置中新增：`/tcb/uploadfile`；若仍报错，可再试 `/_/tcb/uploadfile`（云托管内网实际路径）。保存后重新发布。  
- 方案 B（已实现）：后端在收到 85107 时会自动改用**公网 API**（`https://api.weixin.qq.com/tcb/uploadfile?access_token=xxx`）。只需在环境变量中配置 **WECHAT_APPID**、**WECHAT_SECRET**（与小程序登录共用），无需改白名单即可获取直传凭证。

## 备选方案：其他大文件走对象存储

若网关无法调大或仍频繁 413，可改为「先传存储，再让后端读」：

1. **前端/管理端**：先把文件上传到 **微信云托管对象存储 / 腾讯云 COS**（走存储的上传接口，一般有更大单文件限制）。
2. 上传成功后拿到 **文件 URL 或 fileID**。
3. 调用你的后端接口时只传 **URL 或 fileID**（请求体很小，不会 413）。
4. **后端**：根据 URL/fileID 从存储下载到临时目录，再执行业务逻辑；处理完删临时文件。

这样大文件不经过网关请求体，仅一次小请求 + 后端从存储拉取，可规避 413。

---

**总结**：413 多数由微信云托管/腾讯云接入层限制导致。优先在控制台查找「请求体/上传大小」类配置；若无，再考虑联系支持或采用「先传存储、再传 URL/fileID」的方案。
