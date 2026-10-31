<p align="center">
  <img src="public/music_icon.png" alt="qqmusic-dl app icon" width="120">
</p>

<h1 align="center">qqmusic-dl</h1>

<p align="center">
  A lightweight local QQ Music downloader with a desktop app, web UI, and agent-friendly REST API.
</p>

<p align="center">
  <a href="https://github.com/2921323707/qqmusic-dl/actions/workflows/ci.yml"><img src="https://github.com/2921323707/qqmusic-dl/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/2921323707/qqmusic-dl/releases/latest"><img src="https://img.shields.io/github/v/release/2921323707/qqmusic-dl" alt="Latest release"></a>
</p>

> **Use responsibly.** This project is intended for personal learning, research, and backing up music you are authorized to access. Follow the QQ Music terms of service and applicable copyright law. Do not redistribute downloaded content or use it commercially.

## Features

- **Song search**: Search by keyword and inspect the best available quality information before downloading.
- **Playlist import**: Resolve a public QQ Music playlist, preview its tracks, and select songs for batch download.
- **17 quality options**: Choose from MP3, AAC, OGG, lossless FLAC, and experimental premium formats. Automatic fallback can move down the quality ladder when the requested format is unavailable.
- **Reliable download queue**: Configurable concurrency, exponential retry, cancellation, manual retry, duplicate-file detection, and recovery after restart.
- **Metadata handling**: Every format gets sidecar `.cover.jpg/.cover.png/.cover.webp` and `.lrc` files; MP3 and FLAC additionally support embedded covers, ID3 tags, and Vorbis comments. Existing libraries can repair missing covers from the UI.
- **Built-in player**: Play MP3, FLAC, OGG, and AAC files with range-based streaming, seeking, previous/next controls, and a synchronized lyrics panel.
- **Library management**: Browse downloaded tracks, repair missing covers, reveal files in the system file manager, remove records or files, and clean missing-file entries.
- **Desktop lyrics**: Use a native always-on-top lyrics window in the desktop app or Document Picture-in-Picture in Chrome and Edge.
- **Secure local operation**: The Fastify service listens on `127.0.0.1` by default, credentials are encrypted, and the Electron renderer runs with context isolation and sandboxing.
- **Agent API**: Control search, downloads, tasks, playlists, and the media library over REST.

## Requirements

- Node.js `22.12.0` or newer
- npm
- Windows 10/11 for the packaged desktop app

The project uses Node's built-in `node:sqlite` module and does not require a native database build step.

## Quick Start

```powershell
git clone https://github.com/2921323707/qqmusic-dl.git
cd qqmusic-dl
npm install
npm start
```

Open <http://127.0.0.1:7800>.

If port `7800` is already in use, set another port before starting:

```powershell
$env:QQDL_PORT = "7801"
npm start
```

## Desktop App

The Electron shell starts the existing local Fastify service and displays it in a native application window. The backend remains bound to the loopback interface by default.

```powershell
# Run the desktop app in development mode
npm run desktop

# Build a Windows x64 NSIS installer
npm run dist
```

The installer is written to:

```text
dist/qqmusic-dl-Setup-<version>.exe
```

Installed builds use these locations by default:

- Data: `%APPDATA%\qqmusic-dl\data`
- Downloads: `%USERPROFILE%\Music\qqmusic-dl`

An existing `data/` directory beside the executable, in the portable app directory, or in the current working directory is migrated on first launch. Downloaded music files are not copied automatically.

Closing the main window minimizes the app to the system tray. The tray menu can restore the window, open the download directory, or quit the app completely.

The generated installer is not code-signed. Windows SmartScreen may show an "Unknown publisher" warning.

Prebuilt Windows and macOS assets are available on the [latest release page](https://github.com/2921323707/qqmusic-dl/releases/latest) when published.

## Android App

The `android/` project is a standalone Kotlin and Jetpack Compose app. It talks
directly to the public QQ Music endpoints and does not start the local service
or depend on port `7800`.

The initial mobile release supports song search, public-quality downloads with
fallback, progress and cancellation, a persistent local library, local
playback, and optional export to `Music/qqmusic-dl`. MP3 and M4A exports include
title, artist, album, and embedded cover metadata.

Requirements:

- JDK 17
- Android SDK Platform 35 and Build-Tools 35.0.0
- Android 8.0 (API 26) or newer

```powershell
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleRelease --console=plain
```

Release signing is read from the ignored `android/keystore.properties` file.
See [docs/android.md](docs/android.md) for signing, storage behavior, build
output, and manual acceptance steps.

Android MVP limitations: QQ account login, VIP-only qualities, background
playback, and floating lyrics are not implemented yet.

## Sign In

Search and standard-quality downloads can work without an account. VIP-only qualities require a QQ Music login.

Use the **Scan to sign in** action in the web UI, or call the API:

```powershell
# Create a QR code. The response contains a base64-encoded PNG.
Invoke-RestMethod -Uri http://127.0.0.1:7800/api/auth/qrcode -Method Post

# Poll every two seconds until the status is DONE.
Invoke-RestMethod -Uri http://127.0.0.1:7800/api/auth/qrcode/<qrId>
```

Credentials are encrypted with AES-256-GCM. The encrypted credentials and the local key are stored separately and are never included in the repository.

## REST API

The complete contract is documented in [docs/api.md](docs/api.md).

### Search and download

```powershell
# Search
Invoke-RestMethod "http://127.0.0.1:7800/api/search?keyword=Jay%20Chou&num=10"

# Queue a single song. If quality is omitted, the configured default is used.
$body = @{ mid = "003aAYrm3GE0Ac"; quality = "F000" } | ConvertTo-Json
Invoke-RestMethod `
  -Uri http://127.0.0.1:7800/api/downloads `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

# Queue a batch
$body = @{
  items = @(
    @{ mid = "003aAYrm3GE0Ac" }
    @{ mid = "004Yi5BD3ksoAN"; quality = "M800" }
  )
} | ConvertTo-Json -Depth 4
Invoke-RestMethod `
  -Uri http://127.0.0.1:7800/api/downloads/batch `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

### Tasks

```powershell
# Status values: pending, active, downloading, success, failed, canceled
Invoke-RestMethod "http://127.0.0.1:7800/api/tasks?status=downloading,failed"

Invoke-RestMethod -Uri "http://127.0.0.1:7800/api/tasks/<id>/cancel" -Method Post
Invoke-RestMethod -Uri "http://127.0.0.1:7800/api/tasks/<id>/retry" -Method Post
```

### Playlist download

If `mids` is omitted, every resolved track is queued.

```powershell
$body = @{
  input = "https://y.qq.com/n/ryqq_v2/playlist/8740590963"
  quality = "F000"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri http://127.0.0.1:7800/api/playlist/download `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

### curl

```bash
curl -X POST http://127.0.0.1:7800/api/downloads \
  -H "Content-Type: application/json" \
  -d '{"mid":"003aAYrm3GE0Ac","quality":"F000"}'
```

If `QQDL_API_TOKEN` is configured, include:

```text
Authorization: Bearer <token>
```

## Duplicate and Quality Rules

Batch and playlist imports compare existing downloads by `mid` and quality.

| Situation                                                | Behavior                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Same quality already exists and the file is present      | Skip the track                                                                         |
| Same quality has an active task                          | Skip the track                                                                         |
| A lower quality exists and a higher quality is requested | Download the higher quality; both versions can coexist                                 |
| A higher quality exists and a lower quality is requested | Skip the lower quality by default                                                      |
| A lower-quality copy is explicitly required              | Send `"force": true`                                                                   |
| Requested quality is `AUTO`                              | Resolve the highest usable quality at download time and apply file-level deduplication |

To remove obsolete versions, delete the unwanted files and use **Clean missing records** in the library view.

## Configuration

Environment variables:

| Variable               | Default                          | Description                                          |
| ---------------------- | -------------------------------- | ---------------------------------------------------- |
| `QQDL_HOST`            | `127.0.0.1`                      | HTTP listen address                                  |
| `QQDL_PORT`            | `7800`                           | HTTP listen port                                     |
| `QQDL_API_TOKEN`       | Empty                            | Require `Authorization: Bearer <token>` for `/api/*` |
| `QQDL_DOWNLOAD_DIR`    | `./downloads`                    | Download directory                                   |
| `QQDL_DATA_DIR`        | `./data`                         | SQLite database, credentials, and device data        |
| `QQDL_CONCURRENCY`     | `2`                              | Concurrent downloads, from 1 to 8                    |
| `QQDL_DEFAULT_QUALITY` | `F000`                           | Default quality code                                 |
| `QQDL_NAMING`          | `{artist} - {title} [{quality}]` | Output path template                                 |
| `QQDL_FALLBACK`        | Enabled                          | Set to `0` to disable automatic quality fallback     |
| `QQDL_MAX_RETRIES`     | `3`                              | Maximum attempts for a retryable task                |
| `QQDL_TIMEOUT_MS`      | `120000`                         | Per-request HTTP timeout in milliseconds             |

The following settings can also be changed at runtime from the web UI or `PUT /api/config`:

- `namingTemplate`
- `downloadDir`
- `concurrency`
- `defaultQuality`
- `fallback`
- `maxRetries`

Runtime settings are persisted in SQLite. Changing `downloadDir` affects new downloads and does not move existing files.

On desktop builds, use **Settings > Download directory > Choose folder** to open the native directory picker.

### Naming templates

Supported placeholders:

- `{artist}`
- `{title}`
- `{album}`
- `{quality}`
- `{year}`

Use `/` to create subdirectories, for example:

```text
{artist}/{album}/{title}
```

The default layout places the audio file and its sidecar `.lrc` in a per-song directory:

```text
{artist} - {title} [{quality}]/{artist} - {title} [{quality}]
```

## Quality Support

The highest available quality varies by track. `AUTO` probes from the highest quality downward and downloads the best usable result.

| Code                                           | Format                                            | Typical access                                    |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `AUTO`                                         | Highest available                                 | Depends on the track                              |
| `F000`                                         | SQ lossless FLAC                                  | VIP                                               |
| `O801` / `O800` / `O600` / `O400`              | OGG 640 / 320 / 192 / 96                          | Some tracks require VIP                           |
| `M800`                                         | MP3 320                                           | Some tracks require VIP                           |
| `M500`                                         | MP3 128                                           | Usually free                                      |
| `C600` / `C400` / `C200`                       | AAC 192 / 96 / 48                                 | Usually free                                      |
| `AI00`, `Q000`, `Q001`, `Q003`, `DT03`, `D004` | Premium lossless, spatial audio, DTS:X, and Dolby | Experimental; often unavailable and may fall back |

Notes:

- Premium formats can return placeholder URLs that fail at the CDN. The downloader probes resolved URLs and continues down the quality ladder when a link is invalid.
- Dolby Atmos files are typically E-AC3 audio inside an `.mp4` container and may not play in the browser. Use a local player such as VLC, foobar2000, or Poweramp.
- `TL01` is disabled by default because it requires proprietary decoding and is usually encrypted.
- Digital albums may require a separate purchase even when the account has VIP access.
- An expired login disables VIP qualities until the QR sign-in flow is completed again.

## Data and Security

- The service binds to `127.0.0.1` by default.
- The Electron renderer uses `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- IPC handlers validate the sending window.
- Download and media-library operations are restricted to the configured download directory.
- Credentials are encrypted with AES-256-GCM and the encryption key is stored separately.
- `data/`, `downloads/`, logs, partial files, and build artifacts are excluded from Git.

Do not commit or share the contents of `data/`. To move a login between machines, copy `credentials.enc` and `secret.key` together. If either file is missing, sign in again.

## Project Structure

```text
qqmusic-dl/
|-- src/
|   |-- server.js        # Server entry point
|   |-- config.js        # Environment configuration
|   |-- db.js            # SQLite tasks, files, and settings
|   |-- qq.js            # QQ Music adapter
|   |-- auth.js          # QR login and encrypted credentials
|   |-- queue.js         # Persistent in-memory download queue
|   |-- task.js          # Single-download orchestration
|   |-- metadata.js      # Tags, embedded covers, and sidecar covers/lyrics
|   |-- settings.js      # Runtime settings
|   |-- routes/          # REST API and static UI routes
|   `-- util/            # Naming, lyrics, and crypto helpers
|-- public/              # Zero-build web UI
|-- electron/            # Desktop shell, preloads, tray, and lyrics window
|-- android/             # Standalone Kotlin and Jetpack Compose Android app
|-- vendor/QQMusicapi    # Upstream QQ Music API implementation
|-- docs/                # API contract and architecture decisions
|-- test/                # Node test suite
|-- data/                # Runtime data, ignored by Git
`-- downloads/           # Downloaded music, ignored by Git
```

See [docs/architecture.md](docs/architecture.md) for the architecture and ADR history.

## Development

```powershell
# Lint, formatting check, and tests
npm run check

# Watch mode
npm run dev

# Test watch mode
npm run test:watch
```

The test suite uses Node's built-in test runner. Network-facing operations are injected so CI does not contact QQ Music or its CDN.

## Updating the Upstream Adapter

`vendor/QQMusicapi` is tracked as a separate upstream checkout. Keep project-specific behavior in `src/qq.js` and avoid editing vendored files.

```powershell
Set-Location vendor\QQMusicapi
git pull
Set-Location ..\..
npm start
```

## Troubleshooting

### The app cannot start because port 7800 is busy

Set another port before starting:

```powershell
$env:QQDL_PORT = "7801"
npm start
```

### Windows shows an unknown publisher warning

Current installers are not code-signed. Verify that the file came from the official release page before running it.

### A premium-quality download falls back to another format

This is expected when the account lacks access, a track has no premium source, or the CDN rejects the resolved URL. The completed task displays the quality that was actually downloaded.

### A downloaded Dolby file does not play in the web player

Use a desktop media player that supports E-AC3 audio in an MP4 container.

## Credits

- [Suxiaoqinx/QQMusicapi](https://github.com/Suxiaoqinx/QQMusicapi) - Node.js implementation of QQ Music signing, QIMEI, and lyric decryption
- [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi) - upstream prototype
- [qmc-decoder](https://github.com/ownlight6/qmc-decoder) - reference for QMC encrypted formats

## License

The project source code is licensed under the [MIT License](LICENSE). Vendored code remains subject to its upstream license.
