# qqmusic-dl REST API 契约

Base URL：`http://127.0.0.1:7800`（可用 `QQDL_HOST`/`QQDL_PORT` 修改）
若设置 `QQDL_API_TOKEN`，所有 `/api/*` 请求需带 `Authorization: Bearer <token>`。
所有响应为 JSON。错误统一格式：`{ "error": { "code": "STRING_CODE", "message": "人类可读信息" } }`。

## 认证 Auth

### GET /api/auth/status
当前登录状态。
```json
{
  "loggedIn": true,
  "musicid": 12345678,
  "expired": false,
  "keyExpiresAt": "2026-09-01T00:00:00.000Z",
  "loginType": 2
}
```

### POST /api/auth/qrcode
发起扫码登录。返回二维码 PNG 的 base64 与轮询 id。
```json
{ "qrId": "uuid", "image": "data:image/png;base64,....", "expiresIn": 180 }
```

### GET /api/auth/qrcode/:qrId
轮询扫码状态（建议前端 2s 一次）。
```json
{ "event": "SCAN", "message": "已扫描，请在手机确认" }
```
`event` 取值：`SCAN`（等待扫描）/ `CONF`（已扫描，待手机确认）/ `DONE`（登录成功）/ `REFUSE`（拒绝）/ `TIMEOUT`（过期）/ `OTHER`（未知）。
`DONE` 时附带 `"loggedIn": true`。

### POST /api/auth/logout
登出并清除本地凭证。返回 `{ "ok": true }`。

## 搜索 Search

### GET /api/search?keyword=<kw>&page=1&num=20
```json
{
  "keyword": "尾戒",
  "page": 1,
  "num": 20,
  "songs": [
    {
      "mid": "002eu1MJ3nwzGg",
      "songId": 123456,
      "title": "尾戒",
      "artist": "周杰伦",
      "album": "跨时代",
      "albumMid": "0000",
      "duration": 255,
      "cover": "https://y.gtimg.cn/music/photo_new/T002R300x300M000xxx.jpg",
      "qualities": ["M500", "M800", "F000"]
    }
  ]
}
```
`qualities` 为 best-effort 可用音质清单（源自详情 `file.size_*` **经典码率**字段，不含臻品系——QQ 不报告其可用性，故 UI 不展示“最高音质”预览）。仅供参考；权威信号以 AUTO 实际下载结果为准。

### GET /api/songs/:mid
单曲详情 + best-effort 音质可用性。
```json
{
  "mid": "002eu1MJ3nwzGg",
  "songId": 123456,
  "title": "尾戒",
  "artist": "周杰伦",
  "album": "跨时代",
  "duration": 255,
  "cover": "https://...",
  "qualities": [{ "code": "F000", "label": "SQ 无损", "available": true }]
}
```

## 下载 Downloads

### POST /api/downloads
创建下载任务（幂等：按 mid + 音质判断，规则见下）。

请求体：
```json
{ "mid": "002eu1MJ3nwzGg", "quality": "F000", "fallback": true, "force": false }
```
- `quality`：可选，缺省取设置中的 `default_quality`
- `fallback`：可选，缺省 true——目标音质无权限时沿音质阶梯自动降级
- `force`：可选，缺省 false——强制下载（即使媒体库已有更高音质）

响应 `201`（新建）或 `200`（去重）：
```json
{
  "task": { "id": "uuid", "mid": "...", "quality": "F000", "status": "pending", "...": "..." },
  "deduped": false,
  "dedupeReason": "already_downloaded | in_progress | higher_quality_exists",
  "message": "已有更高音质（SQ 无损），不重复下载更低音质"
}
```

去重规则：
1. 同品质已下载（文件在盘上）→ 跳过（`already_downloaded`）
2. 同品质有进行中的任务 → 跳过（`in_progress`）
3. 已有**更高**音质 → 跳过（`higher_quality_exists`，不降级；`force: true` 可 override）
4. 已有**更低**音质 → 放行（升级下载，文件并存）
5. `quality: "AUTO"` → 只做 1/2 判断，实际音质由降级链决定

`deduped: true` 时 `task` 可能为 null（如更高音质已存在、无对应请求音质的任务）。

错误：`QUALITY_NOT_ALLOWED`、`NOT_LOGGED_IN`（VIP 音质需要登录，`error.hint` 含引导）。

### POST /api/downloads/batch
批量创建。请求体：`{ "items": [{ "mid": "...", "quality": "F000" }], "fallback": true }`
响应：`{ "tasks": [...], "deduped": [...], "errors": [...] }`（与单个接口的 task 结构一致；去重规则相同）。

## 歌单 Playlist

支持拉取任意**公开歌单**（含他人歌单，无需登录）。输入接受完整分享链接或纯数字歌单 ID：
`https://y.qq.com/n/ryqq_v2/playlist/8740590963`、`https://y.qq.com/playlist/8740590963`、`8740590963`。

### GET /api/playlist/resolve?input=<链接或ID>
```json
{
  "id": "8740590963",
  "title": "旅行",
  "cover": "https://y.gtimg.cn/music/photo_new/T002R300x300M000xxx.jpg",
  "creator": "白露未晞",
  "trackCount": 4,
  "songs": [
    {
      "mid": "0011m4yA2jFqa6",
      "songId": 293597409,
      "title": "Ocean in Motion",
      "artist": "Eldar Kedem",
      "album": "Ocean in Motion",
      "albumMid": "001Vlxu11iKMsZ",
      "duration": 194,
      "cover": "https://y.gtimg.cn/music/photo_new/T002R300x300M000001Vlxu11iKMsZ.jpg",
      "qualities": ["F000", "O600", "M800", "M500"]
    }
  ]
}
```
错误：`BAD_PLAYLIST_INPUT`（无法识别）/ `PLAYLIST_NOT_FOUND`（歌单不存在或私密）。

### POST /api/playlist/download
解析歌单并批量创建下载任务（一次调用，适合 Agent 调度整个歌单）。

请求体：
```json
{ "input": "8740590963", "quality": "F000", "mids": ["0011m4yA2jFqa6"], "force": false }
```
- `input`：歌单链接或 ID（必填）
- `quality`：可选，缺省用默认音质
- `mids`：可选，只下载歌单中指定的歌曲（缺省为全部；单次上限 300 首）
- `fallback`：可选，同 `/api/downloads`
- `force`：可选，同 `/api/downloads`（强制下载更低音质副本）

响应 `201`：
```json
{
  "playlist": { "id": "8740590963", "title": "旅行", "creator": "白露未晞", "trackCount": 4 },
  "quality": "M500",
  "tasks": [ { "id": "uuid", "mid": "...", "title": "...", "status": "pending", "...": "..." } ],
  "deduped": [],
  "skipped": [ { "mid": "...", "title": "...", "reason": "higher_quality_exists", "message": "已有更高音质（SQ 无损），不重复下载更低音质" } ],
  "errors": []
}
```

## 任务 Tasks

### GET /api/tasks?status=pending,active,success,failed,canceled
```json
{
  "tasks": [
    {
      "id": "uuid",
      "mid": "002eu1MJ3nwzGg",
      "title": "尾戒",
      "artist": "周杰伦",
      "quality": "F000",
      "qualityLabel": "SQ 无损",
      "status": "downloading",
      "progress": 0.42,
      "received": 12345678,
      "total": 29360128,
      "filePath": "downloads/周杰伦/跨时代/周杰伦 - 尾戒 [SQ].flac",
      "error": null,
      "attempts": 1,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```
`status` 取值：`pending` / `active` / `downloading` / `success` / `failed` / `canceled`。
`progress` 为 0~1；服务端未返回 Content-Length 时为 `null`。

### GET /api/tasks/:id
单个任务详情（结构同上）。

### POST /api/tasks/:id/cancel
取消未完成的任务。返回更新后的 task。

### POST /api/tasks/:id/retry
重置 failed/canceled 任务为 pending 重新入队。

### POST /api/tasks/clear
清空**已结束**的任务记录（成功/失败/取消）；进行中/等待中的任务不受影响。返回 `{ "ok": true, "removed": 12 }`。
注意路由为固定路径 `clear`，与 `:id` 参数路由不冲突（id 均为 uuid）。

> 任务列表排序：进行中/等待中的任务始终置顶，已结束任务排在其后，组内均按创建时间倒序。

## 媒体库 Library

### GET /api/library?q=<关键字>&limit=100&offset=0
```json
{
  "total": 2,
  "files": [
    {
      "id": 1,
      "mid": "002eu1MJ3nwzGg",
      "title": "尾戒",
      "artist": "周杰伦",
      "album": "跨时代",
      "quality": "F000",
      "filePath": "downloads/周杰伦/跨时代/周杰伦 - 尾戒 [SQ].flac",
      "size": 29360128,
      "createdAt": "..."
    }
  ]
}
```

### GET /api/library/:id/audio
流式播放本地音频文件（内置播放器用）。支持 `Range` 请求（206 Partial Content + `Content-Range`），越界返回 416，文件丢失返回 404。

### GET /api/library/:id/cover
提取文件内嵌封面（MP3 走 ID3、FLAC 走 PICTURE 块），返回图片二进制；无内嵌封面返回 404。

### GET /api/library/:id/lrc
返回歌曲歌词（`text/plain; charset=utf-8`）：优先读音频同目录的侧车 `.lrc`，其次提取文件内嵌歌词（MP3 ID3 / FLAC VORBIS_COMMENT 的 LYRICS 字段）；都没有返回 404 `NO_LYRICS`。

### POST /api/library/cleanup
清理所有“文件已丢失”的媒体库记录（仅删 DB 记录，不动磁盘）。返回 `{ "removed": 3 }`。

> 注：音频/封面端点不受 API Token 保护（`<audio>`/`<img>` 无法携带 Authorization 头；服务默认仅监听 127.0.0.1）。
>
> `GET /api/library` 返回的每个 file 带 `exists` 字段：磁盘文件被外部移动/删除时为 `false`，UI 会置灰并提示“文件缺失”。

### POST /api/library/:id/locate
在系统文件管理器中**定位并选中**该文件（服务与本机浏览器同机时可用）。返回 `{ "ok": true, "path": "..." }`。

### POST /api/library/:id/delete
删除媒体库记录。请求体 `{ "removeFile": true }`（缺省 true）：
- `true`：同时删除磁盘文件、侧车 `.lrc` 及空的歌曲文件夹，再删记录
- `false`：仅删除媒体库记录，磁盘文件保留

返回 `{ "ok": true, "fileRemoved": true, "title": "..." }`。路径穿越防护：只允许操作下载目录内的文件。

### POST /api/system/open-download-dir
在系统文件管理器中打开下载目录（Windows explorer / macOS open / Linux xdg-open）。

## 配置 Config

### GET /api/config
```json
{
  "namingTemplate": "{artist} - {title} [{quality}]/{artist} - {title} [{quality}]",
  "downloadDir": "M:\\Dev\\Projects\\dsh\\workspace\\qqmusic-dl\\downloads",
  "concurrency": 2,
  "defaultQuality": "AUTO",
  "fallback": true,
  "maxRetries": 3,
  "qualities": [
    { "code": "AUTO", "label": "最高可用", "ext": "" },
    { "code": "AI00", "label": "臻品母带", "ext": ".flac" },
    { "code": "F000", "label": "SQ 无损", "ext": ".flac" }
  ]
}
```

> `AUTO`（最高可用）：不同歌曲支持的最高音质不同，AUTO 会逐级从最高音质开始探测，取该歌曲实际可用的最高音质下载；任务完成后 `quality`/`qualityLabel` 更新为实际音质。其余字段见上文。

### PUT /api/config
请求体为上述字段的子集（camelCase，亦接受 snake_case 如 `naming_template`），返回更新后的完整配置。
`namingTemplate` 支持占位符：`{artist}` `{title}` `{album}` `{quality}` `{year}`；支持 `/` 分子目录。

## 健康检查

### GET /api/health
`{ "ok": true, "uptime": 12.3 }`
