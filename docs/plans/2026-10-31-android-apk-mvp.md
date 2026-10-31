# Android APK MVP Implementation Plan

> **Goal:** Build, test, verify, and deliver a standalone Android APK for
> searching QQ Music tracks, resolving the best available quality, downloading
> audio, browsing the local library, and playing downloaded tracks.

**Architecture:** Add an `android/` Gradle project using Kotlin and Jetpack
Compose. The Android app talks directly to QQ Music's public JSON endpoints and
does not require the Electron app, Fastify server, or port 7800. OkHttp handles
network requests, coroutines run background work, app-private storage owns the
download queue and metadata index, and MediaStore exports completed audio into
the device's shared Music collection.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, OkHttp, kotlinx.serialization,
Coil, AndroidX Media3, Coroutines, JUnit, Android Gradle Plugin, Gradle Kotlin
DSL.

---

## Scope And Acceptance

### Deliverable

- A signed, installable APK at `android/app/build/outputs/apk/release/`.
- Package ID `com.qqmusicdl.mobile`.
- Minimum Android 8.0 (API 26), target Android 15 (API 35).
- No dependency on the desktop service or a local HTTP port.

### Required User Flow

1. Launch the app and see the product library/search screen.
2. Search by song, artist, or keyword.
3. Select a track and choose automatic or a specific quality.
4. Resolve a playable URL, falling back from higher to lower qualities.
5. Download with progress, cancellation, and a readable error state.
6. Store the completed audio in the app library and export it to
   `Music/qqmusic-dl`.
7. Play a downloaded track inside the app.
8. Persist the library across app restarts.
9. Display cover art with a stable placeholder when remote artwork fails.

### Verification Gates

- `./gradlew test` passes parser, quality fallback, naming, and state tests.
- `./gradlew lint` passes with no release-blocking issues.
- `./gradlew assembleRelease` succeeds.
- `apksigner verify --verbose` reports a valid signature.
- The APK installs and launches on an Android emulator or connected device.
- A screenshot confirms the first screen is nonblank and usable.
- A real public-network search returns at least one track during acceptance.
- A downloaded sample is playable by Media3 and appears in the shared Music
  collection when export succeeds.

---

### Task 1: Install And Pin The Android Toolchain

**Files:**
- Create: `android/local.properties` (ignored, machine-specific)
- Modify: `.gitignore`

**Step 1:** Install Android command-line tools, platform 35, build tools 35.0.0,
and a compatible emulator image under `%LOCALAPPDATA%\Android\Sdk`.

**Step 2:** Create `android/local.properties` with `sdk.dir`.

**Step 3:** Run `sdkmanager --licenses` and `sdkmanager --list_installed`.

Expected: platform 35 and build tools 35.0.0 are installed.

### Task 2: Scaffold A Buildable Compose Application

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/proguard-rules.pro`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/MainActivity.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/App.kt`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/res/values/themes.xml`
- Generate: Gradle wrapper

**Step 1:** Add the minimal Compose theme and a "qqmusic-dl" home screen.

**Step 2:** Run `./gradlew assembleDebug`.

Expected: `app-debug.apk` is created.

**Step 3:** Commit the buildable scaffold.

### Task 3: Define API Models And Parsers Test-First

**Files:**
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/model/Song.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/model/Quality.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/api/QqResponseParser.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/data/api/QqResponseParserTest.kt`
- Test fixtures: `android/app/src/test/resources/fixtures/search.json`

**Step 1:** Write failing tests for highlighted titles, singer joins, cover URL,
duration, and available qualities.

**Step 2:** Run `./gradlew testDebugUnitTest`.

Expected: tests fail because the parser is missing.

**Step 3:** Implement tolerant JSON parsing using `kotlinx.serialization`'s JSON
tree API so upstream field additions do not break the app.

**Step 4:** Re-run tests and commit.

### Task 4: Implement Search

**Files:**
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/api/QqMusicClient.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/repository/SearchRepository.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/data/repository/SearchRepositoryTest.kt`
- Modify: `android/app/src/main/java/com/qqmusicdl/mobile/ui/App.kt`

**Step 1:** Implement a public search request using `music.adaptor.SearchAdaptor`
with `do_search_v2`.

**Step 2:** Add a MockWebServer test for the exact request body and a response
containing multiple tracks.

**Step 3:** Wire search state into the Compose screen with loading, empty, error,
and result states.

**Step 4:** Run unit tests and commit.

### Task 5: Resolve Playback URLs With Quality Fallback

**Files:**
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/repository/PlaybackRepository.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/data/repository/PlaybackRepositoryTest.kt`

**Step 1:** Implement quality descriptors in descending order, excluding the
encrypted `TL01` format.

**Step 2:** Implement `UrlGetVkey` request generation and CDN URL construction.

**Step 3:** Probe each resolved URL with a range request; continue to the next
quality on missing permission, empty purl, HTTP errors, or a false CDN hit.

**Step 4:** Test successful fallback and terminal failure.

**Step 5:** Commit.

### Task 6: Download And Export Completed Audio

**Files:**
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/download/DownloadTask.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/download/DownloadManager.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/storage/MediaStoreExporter.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/storage/FileNameSanitizer.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/data/storage/FileNameSanitizerTest.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/data/download/DownloadStateTest.kt`

**Step 1:** Implement incremental streaming with cancellation and progress.

**Step 2:** Download to app-private temporary storage first.

**Step 3:** Move completed files into app-private permanent storage.

**Step 4:** Export to `Music/qqmusic-dl` through MediaStore without requesting
broad storage permissions.

**Step 5:** Add retry and readable failure states, then commit.

### Task 7: Persist Library Metadata

**Files:**
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/library/LibraryStore.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/data/library/LibraryEntry.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/data/library/LibraryStoreTest.kt`

**Step 1:** Persist entries in a versioned JSON file using atomic replacement.

**Step 2:** Reconcile missing files on startup and remove stale index rows.

**Step 3:** Support deleting both app-owned files and MediaStore exports.

**Step 4:** Test round-trip, duplicate prevention, and missing-file recovery.

### Task 8: Build The Mobile UI

**Files:**
- Modify: `android/app/src/main/java/com/qqmusicdl/mobile/ui/App.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/components/SongRow.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/screens/SearchScreen.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/screens/LibraryScreen.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/screens/SettingsScreen.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/theme/Theme.kt`
- Test: `android/app/src/androidTest/java/com/qqmusicdl/mobile/ui/AppSmokeTest.kt`

**Step 1:** Implement bottom navigation for Search, Library, and Settings.

**Step 2:** Keep the desktop palette: light background with restrained pale-blue
and pale-pink accents.

**Step 3:** Add stable dimensions for cover tiles, progress indicators, and rows.

**Step 4:** Verify text does not overlap at narrow phone widths.

**Step 5:** Commit the UI.

### Task 9: Add Playback

**Files:**
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/playback/PlayerController.kt`
- Create: `android/app/src/main/java/com/qqmusicdl/mobile/ui/components/MiniPlayer.kt`
- Modify: `android/app/src/main/java/com/qqmusicdl/mobile/MainActivity.kt`
- Test: `android/app/src/test/java/com/qqmusicdl/mobile/playback/PlayerStateTest.kt`

**Step 1:** Integrate AndroidX Media3 ExoPlayer.

**Step 2:** Add play/pause, seek, duration, and local-file playback.

**Step 3:** Release the player on lifecycle shutdown.

**Step 4:** Test state transitions and commit.

### Task 10: Release Build, Device Acceptance, And Documentation

**Files:**
- Create: `android/keystore.properties.example`
- Create: `docs/android.md`
- Modify: `.gitignore`
- Modify: `README.md`

**Step 1:** Generate a local release keystore outside version control.

**Step 2:** Configure release signing through ignored `keystore.properties`.

**Step 3:** Run:

```powershell
.\gradlew clean test lint assembleRelease
```

Expected: all tasks succeed.

**Step 4:** Verify:

```powershell
apksigner verify --verbose app\build\outputs\apk\release\app-release.apk
aapt2 dump badging app\build\outputs\apk\release\app-release.apk
```

**Step 5:** Install and launch on the emulator:

```powershell
adb install -r app\build\outputs\apk\release\app-release.apk
adb shell am start -n com.qqmusicdl.mobile/.MainActivity
```

**Step 6:** Run a real search and capture a screenshot.

**Step 7:** Copy the verified APK to the repository's `dist/` directory with a
versioned filename and report its SHA-256.

**Step 8:** Commit and push the Android implementation to `feat/android-app`.

---

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| QQ endpoints require signed Android requests or account credentials | Start with public web/desktop-compatible requests; keep request construction isolated so login support can be added without changing UI/domain code |
| CDN URL expires quickly | Resolve immediately before download and retry once on 403/404 |
| Android scoped storage blocks sidecar files | Keep metadata in app storage; export audio through MediaStore and embed cover metadata in a later enhancement |
| Background downloads are killed by OEM battery policies | Keep foreground downloads short in MVP; add WorkManager/foreground service after core flow is verified |
| No local Android SDK | Install the command-line tools and use a pinned Gradle wrapper |
| MediaStore export succeeds but playback library does not refresh | Call `MediaScannerConnection.scanFile` after export and test on an emulator |

## Explicitly Deferred

- QR account login and VIP-only qualities.
- Floating overlay lyrics and background playback controls.
- Desktop-library import.
- Google Play distribution; the first deliverable is a sideloadable APK.
