# qqmusic-dl

轻量的 QQ 音乐下载服务：**输入歌曲信息 → 选择音质 → 下载**。提供 Web UI 与供 AI Agent 调度的 REST API，基于 Node.js，零原生依赖，本地运行。

> ⚠️ 本项目仅供个人学习研究与备份自己会员权限内的音乐，请遵守 QQ 音乐平台条款与著作权法，勿传播、勿商用。下载的加密/受限内容请仅用于个人离线收听。

## 功能

- 🔍 **歌曲搜索**：关键词搜索，返回歌曲信息与 best-effort 音质可用性
- 🎵 **歌单拉取**：粘贴歌单链接（支持他人公开歌单，无需登录），网页展示曲目、勾选批量下载
- 🎚️ **17 档音质**：从 MP3 128 到臻品母带；VIP 音质需扫码登录；无权限时沿音质阶梯自动降级（可关闭）
- ⬇️ **下载队列**：并发控制（默认 2）、失败指数退避重试、取消/重试、断点去重、重启恢复
- 🏷️ **元数据整理**：嵌入封面与歌词（QRC 解密 → 标准 LRC）、ID3/Vorbis 标签、侧车 `.lrc`、命名模板、按歌手/专辑分子目录
- 🎧 **内置播放器**：媒体库左侧封面缩略图，点击即在底部播放条播放（Range 流式、进度拖拽、上一首/下一首）
  - 浏览器可播：MP3 / FLAC（含 192kHz 24bit 母带）/ OGG / AAC
  - 浏览器**不能**播：D004 杜比全景声（.mp4，E-AC3 编码）——文件本身完好，请用本地播放器（foobar2000 / VLC / Poweramp）打开；网页播放会提示原因
- 📂 **资源管理器联动**：任务页「打开目录」一键打开下载目录；媒体库每行悬停可「定位」（在资源管理器中选中文件）或「删除」（可选连文件一起删，空歌曲文件夹自动清理）
- 🖥️ **桌面歌词**：Windows 桌面版使用 Electron 独立无边框置顶窗口，macOS 桌面版使用原生置顶歌词窗；浏览器版使用 Document Picture-in-Picture（Chrome/Edge 116+）。显示上/当前/下三行 + 进度条，支持字号调节、拖动、点击跳转和关闭；「词」按钮为页面内歌词面板
- 🔐 **登录管理**：QQ 扫码登录，凭证 AES-256-GCM 加密落盘，过期自动探测提醒
- 🤖 **Agent API**：完整 REST 接口，curl 即可编程化调度（搜索 → 建任务 → 查进度 → 媒体库）
- 🖥️ **Web UI**：零构建单页应用，深色主题

## 快速开始

要求 Node.js ≥ 22.12（使用内置 `node:sqlite`，无需编译）。

```powershell
cd qqmusic-dl
npm install
npm start
```

启动后访问 <http://127.0.0.1:7800>。

### Windows 桌面版

项目使用 Electron 将现有 Fastify 服务封装为原生应用窗口，服务仍只监听本机 `127.0.0.1`。

```powershell
# 开发模式：直接打开桌面应用
npm run desktop

# 生成 NSIS 安装包
npm run dist
```

构建产物位于 `dist/`：

- `qqmusic-dl-Setup-<version>.exe`：可选择安装目录的安装版

安装版默认数据目录为 `%APPDATA%\qqmusic-dl\data`，下载目录为 `%USERPROFILE%\Music\qqmusic-dl`。首次启动会尝试从可执行文件目录或当前目录的 `data/` 迁移数据库与登录凭证，不会自动复制已下载音乐。仍可用 `QQDL_DATA_DIR`、`QQDL_DOWNLOAD_DIR`、`QQDL_HOST` 和 `QQDL_PORT` 覆盖默认值。

关闭主窗口会最小化到系统托盘；托盘菜单可重新显示主界面、打开下载目录或完全退出。构建产物未做代码签名，Windows SmartScreen 可能提示“未知发布者”。

### 开发检查

```powershell
npm run check
```

该命令依次执行 ESLint、Prettier 格式检查和无外网依赖的 Node 测试。GitHub Actions 会在 `main` 分支推送和 Pull Request 上运行同一套检查。

首次使用 VIP 音质需登录：Web UI 右上角「扫码登录」，或用 API：

```powershell
# 1. 获取二维码（返回 base64 PNG）
curl -X POST http://127.0.0.1:7800/api/auth/qrcode

# 2. 轮询扫码状态（2s 一次），DONE 即登录成功
curl http://127.0.0.1:7800/api/auth/qrcode/<qrId>
```

## Agent API 示例

PowerShell（推荐 `Invoke-RestMethod`，避免 curl 传参引号问题）：

```powershell
# 搜索
Invoke-RestMethod "http://127.0.0.1:7800/api/search?keyword=稻香&num=10"

# 创建下载任务（quality 省略则用默认音质；fallback 默认开启）
$body = @{ mid = '003aAYrm3GE0Ac'; quality = 'F000' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:7800/api/downloads -Method Post -ContentType 'application/json' -Body $body

# 批量
$body = @{ items = @(@{ mid = '003aAYrm3GE0Ac' }, @{ mid = '004Yi5BD3ksoAN'; quality = 'M800' }) } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:7800/api/downloads/batch -Method Post -ContentType 'application/json' -Body $body

# 查询任务（status 可组合: pending,active,downloading,success,failed,canceled）
Invoke-RestMethod "http://127.0.0.1:7800/api/tasks?status=downloading,failed"

# 取消 / 重试
Invoke-RestMethod -Uri "http://127.0.0.1:7800/api/tasks/<id>/cancel" -Method Post
Invoke-RestMethod -Uri "http://127.0.0.1:7800/api/tasks/<id>/retry" -Method Post

# 媒体库
Invoke-RestMethod "http://127.0.0.1:7800/api/library?q=周杰伦"
```

歌单批量下载（一次调用解析 + 建任务，`mids` 省略则下载全部）：

```powershell
$body = @{ input = 'https://y.qq.com/n/ryqq_v2/playlist/8740590963'; quality = 'F000' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:7800/api/playlist/download -Method Post -ContentType 'application/json' -Body $body
```

bash / cmd 用 curl 即可（注意 PowerShell 下 curl 传含空格的 JSON body 会被拆参，勿用）：

```bash
curl -X POST http://127.0.0.1:7800/api/downloads \
  -H "Content-Type: application/json" \
  -d '{"mid":"003aAYrm3GE0Ac","quality":"F000"}'
```

## 批量下载与去重规则

批量下载（歌单 / `/api/downloads/batch` / `/api/playlist/download`）对“下载过的歌”按 **mid + 音质** 判断：

| 场景 | 行为 |
|---|---|
| 同品质已下载过（文件在盘上） | 跳过，提示“该音质已下载过” |
| 同品质有进行中的任务 | 跳过，提示“任务正在进行中” |
| 已下载过**更低**品质，本次请求更高 | **正常下载**（升级，新旧文件并存——文件名带音质后缀，不会互相覆盖） |
| 已下载过**更高**品质，本次请求更低 | **跳过**（不降级），提示“已有更高音质（SQ 无损），不重复下载更低音质” |
| 确实想要更低音质的副本 | 请求加 `"force": true` 强制下载 |
| AUTO 音质 | 只判断同品质；实际落地音质由降级链决定，与已有文件同名时任务内自动去重 |

想清理多版本：删掉磁盘上不要的文件，再到媒体库点「清理失效记录」即可。

完整契约见 [docs/api.md](docs/api.md)，架构与 ADR 见 [docs/architecture.md](docs/architecture.md)。

## 配置

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `QQDL_HOST` / `QQDL_PORT` | `127.0.0.1` / `7800` | 监听地址 |
| `QQDL_API_TOKEN` | 空 | 设置后 `/api/*` 需 `Authorization: Bearer <token>` |
| `QQDL_DOWNLOAD_DIR` | `./downloads` | 下载目录 |
| `QQDL_DATA_DIR` | `./data` | 数据目录（SQLite、凭证、设备信息） |
| `QQDL_CONCURRENCY` | `2` | 下载并发（1-8） |
| `QQDL_DEFAULT_QUALITY` | `F000` | 默认音质 |
| `QQDL_NAMING` | `{artist} - {title} [{quality}]` | 命名模板 |

命名模板占位符：`{artist}` `{title}` `{album}` `{quality}` `{year}`，支持 `/` 子目录（如 `{artist}/{album}/{title}`）。
除环境变量外，以上均可在 Web UI「设置」页或 `PUT /api/config` 热更新（存 SQLite）。
Windows 桌面版可在「设置 → 下载目录」中点击「选择文件夹」，通过系统原生目录选择窗口设置下载位置。

**默认一歌一文件夹**：`{artist} - {title} [{quality}]/{artist} - {title} [{quality}]`——每首歌的音频与 `.lrc` 同在以其命名的子目录中。想改回平铺或在设置页自定义均可（旧文件不会移动，仅影响新下载）。
除环境变量外，以上均可在 Web UI「设置」页或 `PUT /api/config` 热更新（存 SQLite）。

## 音质说明

**不同歌曲支持的最高音质不同**（版权/母带源差异）。本工具的处理：

1. **AUTO（最高可用）**：音质下拉首选。逐级从臻品母带往下探，取该歌曲**实际可用的最高音质**——不用逐个猜
2. **自动降级**：选定音质无权限时沿阶梯自动下降（可关闭），任务完成后**任务行显示实际下载音质**
3. **假链拦截**：臻品系音质接口可能返回假直链（CDN 404），取链后会做真实性探针，无效自动继续降级

> 注：QQ 详情接口不报告臻品系（AI00/Q000/杜比）可用性（`size_hires` 恒为 0），因此**不做列表内的“最高音质”预览**——避免误导；真实最高音质以 AUTO 实际下载结果为准。

| 档位 | 音质 | 需要登录 | 可靠性 |
|---|---|---|---|
| AUTO | 最高可用（逐曲自适应） | 视歌曲而定 | ✅ 推荐 |
| F000 | SQ 无损 FLAC | VIP | ✅ 稳定 |
| O801 / O800 / O600 / O400 | OGG 640/320/192/96 | 部分 VIP | ✅ 稳定 |
| M800 | MP3 320 | 部分 VIP | ✅ 稳定 |
| M500 | MP3 128 | 免费 | ✅ 稳定 |
| C600 / C400 / C200 | AAC 192/96/48 | 免费为主 | ✅ 稳定 |
| AI00 / Q000 / Q001 / Q003 / DT03 / D004 | 臻品母带、臻品音质、全景声、DTS:X、杜比 | VIP | ⚠️ 实验性：走加密通道，普通接口常返回假链（404），多数歌曲会自动降级到 SQ 无损 |

- `TL01`（.nac 专有编码）默认禁用：需特殊解码且多为加密格式。
- 数字专辑即使 VIP 也需单独购买，接口会返回无权限，任务会以可读的错误信息失败。
- VIP 登录态过期后高音质不可用，UI/API 会提示重新扫码。

## 目录结构

```
qqmusic-dl/
├── src/
│   ├── server.js        # 入口
│   ├── config.js        # 配置
│   ├── db.js            # SQLite（tasks/files/settings）
│   ├── qq.js            # QQ 音乐适配层（搜索/取链/歌词）
│   ├── auth.js          # 扫码登录 + 凭证加密
│   ├── queue.js         # 下载队列
│   ├── task.js          # 单任务编排
│   ├── metadata.js      # FLAC/MP3 标签 + 封面 + LRC
│   ├── settings.js      # 运行时设置
│   ├── routes/          # REST API 与静态 UI
│   └── util/            # 加解密、命名、歌词转换
├── public/              # Web UI（零构建）
├── vendor/QQMusicapi    # 上游 QQ 音乐 API 库（git 跟踪，勿改代码）
├── docs/                # 架构 / ADR / API 契约
├── data/                # 运行时生成：勿提交
└── downloads/           # 下载文件
```

## 维护须知

- **上游更新**：`vendor/QQMusicapi` 是独立 git 仓库（upstream 保留）。QQ 音乐接口变动时：
  ```powershell
  cd vendor/QQMusicapi; git pull; cd ../..; npm start
  ```
  本项目自身代码**不修改 vendor**，所有适配集中在 `src/qq.js`。
- **凭证迁移**：`data/credentials.enc` + `data/secret.key` 需一起拷贝，缺一需重新扫码。
- **安全**：`data/` 含加密凭证与密钥，已列入 `.gitignore`，勿提交或分享。

## 致谢

- [Suxiaoqinx/QQMusicapi](https://github.com/Suxiaoqinx/QQMusicapi) —— QQ 音乐 API 的 Node.js 实现（签名/QIMEI/歌词解密）
- [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi) —— 上游原型
- [qmc-decoder](https://github.com/ownlight6/qmc-decoder) —— QMC 加密格式解密参考

## License

本项目代码仅供学习研究。vendor 目录遵循其上游 License（MIT）。
