/**
 * qqmusic-dl 桌面壳：原生窗口 + 内置 Fastify 服务。
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  Tray,
  dialog,
  nativeImage,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.QQDL_HOST || '127.0.0.1';
const PORT = Number(process.env.QQDL_PORT || 7800);
const APP_URL = `http://${HOST}:${PORT}/`;
const IS_DEV = !app.isPackaged;

const LEGACY_DATA_FILES = [
  'qqdl.sqlite',
  'qqdl.sqlite-wal',
  'qqdl.sqlite-shm',
  'credentials.enc',
  'secret.key',
  'device.json',
];

let mainWindow = null;
let lyricsWindow = null;
let lyricsState = null;
let tray = null;
let serverHandle = null;
let quitting = false;
let shutdownPromise = null;
let logStream = null;

app.setAppUserModelId('com.qqmusicdl.desktop');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(bootstrap).catch(handleFatal);
}

async function bootstrap() {
  setupLogging();
  Menu.setApplicationMenu(null);
  setupRuntimePaths();
  setupIpc();

  try {
    serverHandle = await startBackend();
  } catch (err) {
    await showStartupError(err);
    app.exit(1);
    return;
  }

  await createWindow();
  createTray();

  app.on('activate', () => showMainWindow());
  app.on('before-quit', onBeforeQuit);
  app.on('will-quit', () => {
    tray?.destroy();
    tray = null;
  });

  console.log(`[desktop] 已就绪: ${APP_URL}`);
}

function setupRuntimePaths() {
  const dataDir = process.env.QQDL_DATA_DIR
    ? path.resolve(process.env.QQDL_DATA_DIR)
    : IS_DEV
      ? path.join(ROOT, 'data')
      : path.join(app.getPath('userData'), 'data');
  const downloadDir = process.env.QQDL_DOWNLOAD_DIR
    ? path.resolve(process.env.QQDL_DOWNLOAD_DIR)
    : IS_DEV
      ? path.join(ROOT, 'downloads')
      : path.join(getMusicPath(), 'qqmusic-dl');

  process.env.QQDL_DATA_DIR = dataDir;
  process.env.QQDL_DOWNLOAD_DIR = downloadDir;

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(process.env.QQDL_DOWNLOAD_DIR, { recursive: true });

  if (!IS_DEV) migrateLegacyData(dataDir);
}

function getMusicPath() {
  try {
    return app.getPath('music');
  } catch {
    return path.join(app.getPath('home'), 'Music');
  }
}

/**
 * 首次运行安装版时，尝试从 exe 同目录、portable 目录或当前工作目录迁移旧数据。
 */
function migrateLegacyData(targetDir) {
  if (fs.existsSync(path.join(targetDir, 'qqdl.sqlite'))) return;

  const candidates = [
    process.env.QQDL_LEGACY_DATA_DIR,
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
      : null,
    path.join(path.dirname(app.getPath('exe')), 'data'),
    path.join(process.cwd(), 'data'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const source = path.resolve(candidate);
    if (source === path.resolve(targetDir)) continue;
    if (!fs.existsSync(path.join(source, 'qqdl.sqlite'))) continue;

    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of LEGACY_DATA_FILES) {
      const from = path.join(source, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(targetDir, name));
    }
    console.log(`[desktop] 已从旧目录迁移数据: ${source}`);
    return;
  }
}

async function startBackend() {
  const entry = pathToFileURL(path.join(ROOT, 'src', 'server.js')).href;
  const { startServer } = await import(entry);
  return startServer({ host: HOST, port: PORT });
}

async function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 680,
    center: true,
    show: false,
    backgroundColor: '#101218',
    title: 'qqmusic-dl',
    icon: iconPath('ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: IS_DEV,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 760,
          autoHideMenuBar: true,
          backgroundColor: '#101218',
          icon: iconPath('ico'),
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3) return;
    console.error(`[desktop] 页面加载失败 ${code} ${description}: ${url}`);
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (state.maximized) mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    saveWindowState();
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(APP_URL);
}

function setupIpc() {
  ipcMain.handle('desktop-lyrics:open', async (event, state) => {
    assertMainSender(event);
    await openLyricsWindow(normalizeLyricsState(state));
    return { ok: true };
  });

  ipcMain.on('desktop-lyrics:update', (event, state) => {
    if (!isMainSender(event)) return;
    updateLyricsWindow(normalizeLyricsState(state));
  });

  ipcMain.handle('desktop-lyrics:close', (event) => {
    assertMainSender(event);
    closeLyricsWindow();
    return { ok: true };
  });

  ipcMain.on('desktop-lyrics:seek', (event, seconds) => {
    if (!isLyricsSender(event)) return;
    const time = Number(seconds);
    if (!Number.isFinite(time) || time < 0) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop-lyrics:seek', time);
    }
  });

  ipcMain.on('desktop-lyrics:request-close', (event) => {
    if (!isLyricsSender(event)) return;
    closeLyricsWindow();
  });

  ipcMain.on('desktop-lyrics:ready', (event) => {
    if (!isLyricsSender(event)) return;
    sendLyricsState();
  });
}

async function openLyricsWindow(state) {
  lyricsState = state;

  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    sendLyricsState();
    lyricsWindow.showInactive();
    return;
  }

  const window = new BrowserWindow({
    width: 620,
    height: 162,
    minWidth: 400,
    minHeight: 126,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    resizable: true,
    skipTaskbar: true,
    title: '桌面歌词',
    icon: iconPath('ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: IS_DEV,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'lyrics-preload.cjs'),
    },
  });

  lyricsWindow = window;
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionLyricsWindow(window);

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => {
    if (lyricsWindow === window) lyricsWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop-lyrics:closed');
    }
  });

  try {
    await window.loadFile(path.join(__dirname, 'lyrics.html'));
    if (window.isDestroyed()) return;
    sendLyricsState();
    window.showInactive();
  } catch (err) {
    if (!window.isDestroyed()) window.destroy();
    throw err;
  }
}

function updateLyricsWindow(state) {
  lyricsState = state;
  sendLyricsState();
}

function sendLyricsState() {
  if (!lyricsState || !lyricsWindow || lyricsWindow.isDestroyed()) return;
  lyricsWindow.webContents.send('desktop-lyrics:state', lyricsState);
}

function closeLyricsWindow() {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) {
    lyricsWindow = null;
    return;
  }
  lyricsWindow.close();
}

function positionLyricsWindow(window) {
  const referenceBounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined;
  const display = referenceBounds
    ? screen.getDisplayMatching(referenceBounds)
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const [width, height] = window.getSize();
  window.setPosition(
    Math.round(area.x + (area.width - width) / 2),
    Math.round(area.y + area.height - height - 72),
    false,
  );
}

function normalizeLyricsState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = (key, fallback = '') => {
    const raw = source[key];
    return typeof raw === 'string' ? raw.slice(0, 500) : fallback;
  };
  const optionalNumber = (key) => {
    const number = Number(source[key]);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const progress = optionalNumber('progress');

  return {
    title: text('title', '桌面歌词'),
    previous: text('previous'),
    current: text('current', '播放歌曲后显示歌词'),
    next: text('next'),
    progress: progress === null ? 0 : Math.min(1, progress),
    currentTime: optionalNumber('currentTime'),
    duration: optionalNumber('duration'),
    seekTime: optionalNumber('seekTime'),
    playing: source.playing === true,
  };
}

function isMainSender(event) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents,
  );
}

function isLyricsSender(event) {
  return Boolean(
    lyricsWindow &&
      !lyricsWindow.isDestroyed() &&
      event.sender === lyricsWindow.webContents,
  );
}

function assertMainSender(event) {
  if (!isMainSender(event)) throw new Error('Invalid desktop lyrics sender');
}

function createTray() {
  const source = nativeImage.createFromPath(iconPath('png'));
  const image = source.isEmpty()
    ? nativeImage.createEmpty()
    : source.resize({ width: 16, height: 16 });

  tray = new Tray(image);
  tray.setToolTip('qqmusic-dl');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { label: '打开下载目录', click: openDownloadDir },
      { type: 'separator' },
      { label: '退出', click: requestQuit },
    ]),
  );
  tray.on('double-click', showMainWindow);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openDownloadDir() {
  try {
    const response = await fetch(`${APP_URL}api/system/open-download-dir`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(await response.text());
  } catch (err) {
    dialog.showErrorBox('打开下载目录失败', String(err?.message || err));
  }
}

function onBeforeQuit(event) {
  if (quitting || !serverHandle) return;
  event.preventDefault();
  requestQuit();
}

async function requestQuit() {
  if (quitting) return;
  quitting = true;
  saveWindowState();
  closeLyricsWindow();
  try {
    await shutdown();
  } catch (err) {
    console.error('[desktop] 关闭服务失败:', err);
  } finally {
    app.quit();
  }
}

function shutdown() {
  if (!shutdownPromise) {
    shutdownPromise = serverHandle ? serverHandle.stop() : Promise.resolve();
  }
  return shutdownPromise;
}

function isAppUrl(url) {
  return url === APP_URL || url.startsWith(APP_URL);
}

function iconPath(kind) {
  return kind === 'png'
    ? path.join(ROOT, 'public', 'music_icon.png')
    : path.join(ROOT, 'build', 'icon.ico');
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const fallback = { width: 1280, height: 860, maximized: false };
  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    const width = Number(raw.width);
    const height = Number(raw.height);
    return {
      width: Number.isFinite(width) ? Math.max(1024, Math.round(width)) : fallback.width,
      height: Number.isFinite(height) ? Math.max(680, Math.round(height)) : fallback.height,
      maximized: raw.maximized === true,
    };
  } catch {
    return fallback;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify(
        {
          width: bounds.width,
          height: bounds.height,
          maximized: mainWindow.isMaximized(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error('[desktop] 保存窗口状态失败:', err);
  }
}

function setupLogging() {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(path.join(logDir, 'desktop.log'), { flags: 'a' });

    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);
    const write = (level, args) => {
      logStream.write(
        `[${new Date().toISOString()}] [${level}] ${util.format(...args)}\n`,
      );
    };

    console.log = (...args) => {
      originalLog(...args);
      write('INFO', args);
    };
    console.error = (...args) => {
      originalError(...args);
      write('ERROR', args);
    };
  } catch {
    logStream = null;
  }
}

async function showStartupError(err) {
  console.error('[desktop] 启动失败:', err);
  if (err?.code === 'EADDRINUSE') {
    dialog.showErrorBox(
      '端口被占用',
      `127.0.0.1:${PORT} 已被其他程序占用。\n\n请关闭占用该端口的程序后重新打开 qqmusic-dl。\n\n可用 netstat -ano | findstr :${PORT} 查看占用进程。`,
    );
    return;
  }
  dialog.showErrorBox('qqmusic-dl 启动失败', String(err?.stack || err));
}

function handleFatal(err) {
  console.error('[desktop] 未捕获异常:', err);
  dialog.showErrorBox('qqmusic-dl 启动失败', String(err?.stack || err));
  app.exit(1);
}
