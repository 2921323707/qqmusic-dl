# Android App

The Android app is a standalone Kotlin and Jetpack Compose client for searching
QQ Music, downloading standard-quality audio, managing a local library, and
playing completed tracks. It does not require the Electron app, the Fastify
service, or port `7800`.

## Requirements

- JDK 17
- Android SDK Platform 35
- Android SDK Build-Tools 35.0.0
- An Android 8.0 (API 26) or newer device or emulator

## Build

Create `android/local.properties` with the local SDK path:

```properties
sdk.dir=C:/Users/<name>/AppData/Local/Android/Sdk
```

Then run:

```powershell
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Release Signing

Release builds read signing values from `android/keystore.properties`, which is
ignored by Git. Start from `android/keystore.properties.example`, create the
keystore outside the repository, and keep a secure backup of it. Losing the
signing key prevents upgrades from installing over an existing app.

```powershell
Set-Location android
.\gradlew.bat clean testDebugUnitTest lintDebug assembleRelease --console=plain
```

The signed APK is written to:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Verify it with the installed Android build tools:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --verbose `
  app\build\outputs\apk\release\app-release.apk
```

## Storage

- App-owned audio and the JSON library index stay in app-private storage.
- When export is enabled, completed audio is also published to
  `Music/qqmusic-dl` through MediaStore.
- MP3 files receive ID3v2.3 title, artist, album, and embedded cover metadata.
- M4A files receive the matching iTunes metadata atoms and cover artwork.
- Android 8 and 9 request legacy read and write permissions only for exporting
  to and cleaning up files in the shared Music collection.

Deleting an app library item also attempts to remove its MediaStore export.

## Current Scope

Supported public qualities are MP3 128, AAC 96, and AAC 48 with automatic
fallback. The first mobile version does not include QQ account login, VIP-only
qualities, background playback, or floating lyrics. Downloads run while the app
process is alive.

## Architecture

```text
android/
|-- app/src/main/java/com/qqmusicdl/mobile/
|   |-- data/api/         # Public QQ Music requests and tolerant parsing
|   |-- data/download/    # Streaming downloads and cancellation
|   |-- data/library/     # Versioned JSON index and file reconciliation
|   |-- data/metadata/    # MP3/M4A tags and embedded cover artwork
|   |-- data/storage/     # MediaStore export
|   |-- playback/         # Media3 player state and controls
|   |-- ui/               # Compose search, library, settings, and player
|   `-- AppViewModel.kt   # Screen state and download orchestration
|-- app/src/test/         # JVM unit tests
`-- gradle/               # Pinned Gradle wrapper
```

## Manual Acceptance

1. Search for a public track and select it.
2. Download with automatic quality and confirm progress completes.
3. Play the local file, pause, and seek.
4. Confirm the track, artist, album, and cover appear in the device music app.
5. Restart the mobile app and confirm the library entry remains.
6. Delete the entry and confirm the local export is removed.

Use responsibly and only download content you are authorized to access.

## Verified Baseline

The `0.1.2` release was verified on an Android 8.0 (API 26) emulator with the
following results:

- 18 JVM tests passed across 5 suites, and the API 26 MediaStore export test
  passed.
- Android lint completed with no errors and 6 non-blocking warnings.
- A real public search and download completed for JAY-Z, "Show Me What You Got
  (Radio Edit)".
- The exported MP3 appeared under `Music/qqmusic-dl` with title, artist, album,
  and an embedded MJPEG cover. FFprobe reported a duration of 222.87 seconds.
- Playback, pause, seek, restart persistence, and deletion of both the app
  library item and its MediaStore export passed.
