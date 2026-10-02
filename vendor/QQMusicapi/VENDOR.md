# 第三方源码：QQMusicapi

本目录下的代码**不是本项目作者编写的**，而是从上游仓库
<https://github.com/Suxiaoqinx/QQMusicapi> 原样复制而来的。

- 上游 commit：`b6d748bb63fc65b6a98a383d8974fe3f3fd75d5b`
- 复制日期：2026-09-27
- 改动：**无任何改动**（含 package.json、README 均保持原样）

## 为什么以源码形式存放

它不是可通过 `npm install` 获取的依赖，而是一组协议实现代码。本项目
`src/qq.js` 直接引用其中的：

- `algorithms/sign.js` —— 请求签名（zzc_sign）
- `algorithms/qrc.js` —— QRC 加密歌词解密
- `modules/song.js` —— 获取下载链接（GetVkey）
- `utils/qimei.js` / `utils/device.js` —— 设备指纹（QIMEI）

因此这些文件必须随仓库分发，否则项目无法运行（详见 docs/architecture.md ADR-001）。

## 使用须知

- **上游未声明开源许可证**，按法律默认保留所有权利。请本项目使用者仅将其用于
  **个人学习与非商业用途**，勿对外再分发其中包含的本目录内容。
- 本目录为**只读**：本项目任何业务逻辑改动都不应写入此处，适配一律在 `src/` 内完成。
- 此处保留 `package.json` / `package-lock.json` 仅为记录上游元信息，**不要执行**
  `npm install`（真实依赖由仓库根目录的 package.json 管理）。
