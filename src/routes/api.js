/**
 * REST API 路由（Agent 调度入口）。
 */

import path from 'node:path';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { stat, readFile, rm, rmdir } from 'node:fs/promises';
import * as dbOps from '../db.js';
import * as auth from '../auth.js';
import * as qq from '../qq.js';
import { getSettings, updateSettings } from '../settings.js';
import { extractCover, extractEmbeddedLyrics } from '../metadata.js';
import { randomId } from '../util/crypto.js';

/**
 * 用系统文件管理器打开路径（服务与本机浏览器同机，本地工具场景）。
 * Windows: explorer.exe；macOS: open -R；Linux: xdg-open。
 *
 * 注意：explorer.exe 参数解析特殊——Node spawn 默认会给含空格的参数整体加引号，
 * 把 `/select,` 前缀一起包住导致解析失败（表现为打开“文档”文件夹）。
 * 必须用 windowsVerbatimArguments 原样传参，路径按 Microsoft 文档形式自行加引号。
 * explorer.exe 成功时也可能返回非 0 退出码，故不做退出码判断。
 */
function openInFileManager(target, { select = false } = {}) {
  const platform = process.platform;
  if (platform === 'win32') {
    const arg = select ? `/select,"${target}"` : `"${target}"`;
    spawn('explorer.exe', [arg], {
      windowsVerbatimArguments: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
    return true;
  }
  if (platform === 'darwin') {
    spawn('open', [select ? '-R' : '', target].filter(Boolean), { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (platform === 'linux') {
    spawn('xdg-open', [select ? path.dirname(target) : target], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}

/** 校验路径位于下载目录内（防路径穿越） */
function isInsideDownloadDir(target, downloadDir) {
  const abs = path.resolve(target);
  const base = path.resolve(downloadDir);
  return abs === base || abs.startsWith(base + path.sep);
}

/** 音频文件 MIME */
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
};

/** 流式发送本地音频文件（支持 Range，供内置播放器拖动进度） */
async function streamAudioFile(reply, req, filePath) {
  let st;
  try {
    st = await stat(filePath);
  } catch {
    throw httpError(404, 'FILE_MISSING', '文件已被移动或删除');
  }
  if (!st.isFile()) throw httpError(404, 'FILE_MISSING', '不是有效的音频文件');

  const mime = AUDIO_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;

  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= st.size) {
      reply.code(416).header('Content-Range', `bytes */${st.size}`);
      return reply.send();
    }
    reply
      .code(206)
      .header('Content-Type', mime)
      .header('Content-Length', end - start + 1)
      .header('Content-Range', `bytes ${start}-${end}/${st.size}`)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'no-cache');
    // 交给 Fastify 管理流生命周期（自行 pipe reply.raw 会破坏 keep-alive 连接复用）
    return reply.send(createReadStream(filePath, { start, end }));
  }

  reply
    .code(200)
    .header('Content-Type', mime)
    .header('Content-Length', st.size)
    .header('Accept-Ranges', 'bytes')
    .header('Cache-Control', 'no-cache');
  return reply.send(createReadStream(filePath));
}

/** 这些音质必须登录（VIP）后才可请求 */
const VIP_ONLY = new Set(['AI00', 'Q000', 'Q001', 'Q003', 'DT03', 'D004', 'F000']);
const ACTIVE_STATUSES = ['pending', 'active', 'downloading'];

function httpError(status, code, message, hint) {
  const e = new Error(message);
  e.statusCode = status;
  e.code = code;
  if (hint) e.hint = hint;
  return e;
}

function taskView(t) {
  return {
    id: t.id,
    mid: t.mid,
    title: t.title,
    artist: t.artist,
    album: t.album,
    quality: t.quality,
    qualityLabel: t.qualityLabel,
    status: t.status,
    progress: t.progress,
    received: t.received,
    total: t.total,
    filePath: t.filePath,
    error: t.error,
    attempts: t.attempts,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** 解析音质参数：支持 AUTO（最高可用），非法返回 null */
function resolveQualityMeta(code) {
  if (code === 'AUTO') return qq.AUTO_QUALITY;
  return qq.QUALITY_BY_CODE.get(code) ?? null;
}

/**
 * 批量下载去重/降级判断。
 * 规则：
 *  1. 同品质已在媒体库（文件在盘上）      -> 跳过（already_downloaded）
 *  2. 同品质有进行中的任务               -> 跳过（in_progress）
 *  3. 已有更高音质的有效文件             -> 跳过（higher_quality_exists，不降级；force 可override）
 *  4. 已有更低音质                      -> 放行（升级下载，新旧文件并存）
 *  5. AUTO                               -> 只做 1/2 判断，目标音质运行时才知
 * @returns {{action:'create'} | {action:'skip', reason:string, existingQuality?:string}}
 */
function checkDupe(db, mid, quality, { force = false } = {}) {
  const files = dbOps.listFilesByMid(db, mid).filter((f) => f.exists);
  if (files.some((f) => f.quality === quality)) {
    return { action: 'skip', reason: 'already_downloaded' };
  }
  const active = dbOps.listTasks(db, ACTIVE_STATUSES).find((t) => t.mid === mid && t.quality === quality);
  if (active) return { action: 'skip', reason: 'in_progress' };

  if (!force && quality !== 'AUTO') {
    const reqRank = qq.qualityRank(quality);
    if (reqRank > 0) {
      let bestRank = -1;
      let bestCode = null;
      for (const f of files) {
        const r = qq.qualityRank(f.quality);
        if (r > bestRank) {
          bestRank = r;
          bestCode = f.quality;
        }
      }
      if (bestRank > reqRank) {
        return { action: 'skip', reason: 'higher_quality_exists', existingQuality: bestCode };
      }
    }
  }
  return { action: 'create' };
}

/** 去重跳过时给前端返回的提示信息 */
function dupeMessage(reason, existingQuality) {
  const label = existingQuality ? qq.QUALITY_BY_CODE.get(existingQuality)?.label || existingQuality : '';
  switch (reason) {
    case 'already_downloaded':
      return '该音质已下载过，自动跳过';
    case 'in_progress':
      return '相同音质的下载任务正在进行中';
    case 'higher_quality_exists':
      return `已有更高音质（${label}），不重复下载更低音质`;
    default:
      return '已存在，自动跳过';
  }
}

async function createOne(db, queue, { mid, quality, fallback, force }) {
  const m = String(mid ?? '').trim();
  if (!m) throw httpError(400, 'BAD_REQUEST', 'mid 不能为空');
  const settings = getSettings(db);
  const q = quality ? String(quality) : settings.defaultQuality;
  const qualityMeta = resolveQualityMeta(q);
  if (!qualityMeta) {
    throw httpError(400, 'QUALITY_NOT_ALLOWED', `不支持的音质: ${q}`, `可用: ${qq.qualityOptions().map((x) => x.code).join(', ')}`);
  }
  // VIP 专享音质需登录；AUTO 会自动降级到可用音质，不拦截
  if (VIP_ONLY.has(q) && !auth.getCredential()?.isLoggedIn()) {
    throw httpError(403, 'NOT_LOGGED_IN', `${qualityMeta.label} 需要登录`, '请先调用 POST /api/auth/qrcode 扫码登录');
  }

  // 幂等 / 不降级判断
  const dupe = checkDupe(db, m, q, { force });
  if (dupe.action === 'skip') {
    const existing = dbOps.findSuccessfulTask(db, m, q);
    return {
      task: existing ? taskView(existing) : null,
      deduped: true,
      dedupeReason: dupe.reason,
      message: dupeMessage(dupe.reason, dupe.existingQuality),
    };
  }

  // 预取详情填充展示字段（失败不阻塞，任务执行时会再取）
  let title = null;
  let artist = null;
  let album = null;
  let songId = null;
  try {
    const detail = await qq.getSongDetail(m);
    if (detail) {
      title = detail.title;
      artist = detail.artist;
      album = detail.album;
      songId = detail.songId;
    }
  } catch {
    /* 详情预取失败，执行时再试 */
  }

  const task = dbOps.createTask(db, {
    id: randomId(),
    mid: m,
    songId,
    title,
    artist,
    album,
    quality: q,
    qualityLabel: qualityMeta.label,
    ext: qualityMeta.ext,
    fallback: fallback ?? settings.fallback,
  });
  queue.enqueue(task.id);
  return { task: taskView(task), deduped: false };
}

export default async function apiRoutes(fastify) {
  const db = fastify.db;
  const queue = fastify.queue;

  // ---------- 健康检查 ----------
  fastify.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));

  // ---------- 认证 ----------
  fastify.get('/api/auth/status', async () => {
    const base = auth.authStatus();
    if (!base.loggedIn) return base;
    const expired = await auth.probeExpired();
    return { ...base, expired: expired || base.expired };
  });

  fastify.post('/api/auth/qrcode', async (req, reply) => {
    const { qrId, image, expiresIn } = await auth.startQrLogin();
    reply.code(201);
    return { qrId, image, expiresIn };
  });

  fastify.get('/api/auth/qrcode/:qrId', async (req) => auth.pollQrLogin(req.params.qrId));

  fastify.post('/api/auth/qrcode/:qrId/cancel', async (req) => {
    auth.cancelQrLogin(req.params.qrId);
    return { ok: true };
  });

  fastify.post('/api/auth/refresh', async () => auth.refreshCredential());

  fastify.post('/api/auth/logout', async () => auth.logout());

  // ---------- 搜索 ----------
  fastify.get('/api/search', async (req) => {
    const keyword = String(req.query.keyword ?? '').trim();
    if (!keyword) throw httpError(400, 'BAD_REQUEST', 'keyword 不能为空');
    const page = Math.max(1, Number(req.query.page) || 1);
    const num = Math.min(50, Math.max(1, Number(req.query.num) || 20));
    const songs = await qq.searchSongs(keyword, page, num);
    return { keyword, page, num, songs };
  });

  fastify.get('/api/songs/:mid', async (req) => {
    const detail = await qq.getSongDetail(req.params.mid);
    if (!detail) throw httpError(404, 'SONG_NOT_FOUND', '歌曲不存在');
    return detail;
  });

  // ---------- 下载 ----------
  fastify.post('/api/downloads', async (req, reply) => {
    const result = await createOne(db, queue, req.body ?? {});
    reply.code(result.deduped ? 200 : 201);
    return result;
  });

  fastify.post('/api/downloads/batch', async (req, reply) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw httpError(400, 'BAD_REQUEST', 'items 必须是非空数组');
    }
    if (items.length > 50) {
      throw httpError(400, 'BAD_REQUEST', '单次批量最多 50 个');
    }
    const tasks = [];
    const deduped = [];
    const errors = [];
    for (const item of items) {
      try {
        const r = await createOne(db, queue, item);
        (r.deduped ? deduped : tasks).push(r.task);
      } catch (e) {
        errors.push({ mid: item?.mid, code: e.code ?? 'ERROR', message: e.message });
      }
    }
    reply.code(201);
    return { tasks, deduped, errors };
  });

  // ---------- 歌单 ----------
  fastify.get('/api/playlist/resolve', async (req) => {
    const input = String(req.query.input ?? req.query.url ?? '').trim();
    if (!input) throw httpError(400, 'BAD_REQUEST', 'input 不能为空（歌单链接或 ID）');
    const { resolvePlaylist } = await import('../playlist.js');
    return resolvePlaylist(input, qq.parseSongListItem);
  });

  fastify.post('/api/playlist/download', async (req, reply) => {
    const { input, quality, fallback, mids } = req.body ?? {};
    if (!input) throw httpError(400, 'BAD_REQUEST', 'input 不能为空（歌单链接或 ID）');
    const { resolvePlaylist } = await import('../playlist.js');
    const playlist = await resolvePlaylist(String(input), qq.parseSongListItem);

    // 选定范围：mids 子集（校验必须在歌单内）或全部
    let selected = playlist.songs;
    if (Array.isArray(mids) && mids.length > 0) {
      const want = new Set(mids.map(String));
      selected = playlist.songs.filter((s) => want.has(s.mid));
      if (selected.length === 0) throw httpError(400, 'BAD_REQUEST', 'mids 与歌单歌曲不匹配');
    }
    if (selected.length > 300) {
      throw httpError(400, 'BAD_REQUEST', `歌单歌曲过多（${selected.length} > 300），请用 mids 分批指定`);
    }

    const settings = getSettings(db);
    const q = quality ? String(quality) : settings.defaultQuality;
    const qualityMeta = resolveQualityMeta(q);
    if (!qualityMeta) {
      throw httpError(400, 'QUALITY_NOT_ALLOWED', `不支持的音质: ${q}`);
    }
    if (VIP_ONLY.has(q) && !auth.getCredential()?.isLoggedIn()) {
      throw httpError(403, 'NOT_LOGGED_IN', `${qualityMeta.label} 需要登录`, '请先调用 POST /api/auth/qrcode 扫码登录');
    }

    const tasks = [];
    const deduped = [];
    const errors = [];
    const skipped = [];
    for (const song of selected) {
      try {
        // 同一套去重/不降级判断（force 可强制下载更低音质）
        const dupe = checkDupe(db, song.mid, q, { force: Boolean(req.body?.force) });
        if (dupe.action === 'skip') {
          const existing = dbOps.findSuccessfulTask(db, song.mid, q);
          if (existing) deduped.push(taskView(existing));
          else skipped.push({ mid: song.mid, title: song.title, reason: dupe.reason, message: dupeMessage(dupe.reason, dupe.existingQuality) });
          continue;
        }
        const task = dbOps.createTask(db, {
          id: randomId(),
          mid: song.mid,
          songId: song.songId,
          title: song.title,
          artist: song.artist,
          album: song.album,
          quality: q,
          qualityLabel: qualityMeta.label,
          ext: qualityMeta.ext,
          fallback: fallback ?? settings.fallback,
        });
        queue.enqueue();
        tasks.push(taskView(task));
      } catch (e) {
        errors.push({ mid: song.mid, code: e.code ?? 'ERROR', message: e.message });
      }
    }
    reply.code(201);
    return {
      playlist: { id: playlist.id, title: playlist.title, creator: playlist.creator, trackCount: playlist.trackCount },
      quality: q,
      tasks,
      deduped,
      skipped,
      errors,
    };
  });

  // ---------- 任务 ----------
  fastify.get('/api/tasks', async (req) => {
    const statuses = String(req.query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const tasks = dbOps.listTasks(db, statuses);
    return { tasks: tasks.map(taskView) };
  });

  fastify.get('/api/tasks/:id', async (req) => {
    const t = dbOps.getTask(db, req.params.id);
    if (!t) throw httpError(404, 'TASK_NOT_FOUND', '任务不存在');
    return { task: taskView(t) };
  });

  fastify.post('/api/tasks/:id/cancel', async (req) => {
    const t = queue.cancel(req.params.id);
    if (!t) throw httpError(404, 'TASK_NOT_FOUND', '任务不存在');
    return { task: taskView(t) };
  });

  fastify.post('/api/tasks/:id/retry', async (req) => {
    const t = queue.retry(req.params.id);
    if (!t) throw httpError(404, 'TASK_NOT_FOUND', '任务不存在');
    return { task: taskView(t) };
  });

  // 清空已结束任务（成功/失败/取消）；进行中/等待中的任务保留
  fastify.post('/api/tasks/clear', async () => {
    const removed = queue.clearFinished();
    return { ok: true, removed };
  });

  // ---------- 媒体库 ----------
  fastify.get('/api/library', async (req) => {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    return dbOps.listFiles(db, { q, limit, offset });
  });

  // 音频流（Range 支持，供内置播放器）
  fastify.get('/api/library/:id/audio', async (req, reply) => {
    const row = dbOps.getFile(db, req.params.id);
    if (!row) throw httpError(404, 'FILE_NOT_FOUND', '文件记录不存在');
    await streamAudioFile(reply, req, row.filePath);
    return reply;
  });

  // 内嵌封面（MP3 ID3 / FLAC PICTURE 块提取）
  fastify.get('/api/library/:id/cover', async (req, reply) => {
    const row = dbOps.getFile(db, req.params.id);
    if (!row) throw httpError(404, 'FILE_NOT_FOUND', '文件记录不存在');
    const { buffer, mime } = await extractCover(row.filePath);
    if (!buffer) throw httpError(404, 'NO_COVER', '未找到内嵌封面');
    reply.header('Cache-Control', 'max-age=86400');
    reply.type(mime);
    return reply.send(buffer);
  });

  // 歌词（优先侧车 .lrc，其次文件内嵌歌词）
  fastify.get('/api/library/:id/lrc', async (req, reply) => {
    const row = dbOps.getFile(db, req.params.id);
    if (!row) throw httpError(404, 'FILE_NOT_FOUND', '文件记录不存在');
    let lrc = '';
    try {
      lrc = await readFile(row.filePath.replace(/\.[^.]+$/, '') + '.lrc', 'utf8');
    } catch {
      lrc = '';
    }
    if (!lrc.trim()) lrc = await extractEmbeddedLyrics(row.filePath);
    if (!lrc.trim()) throw httpError(404, 'NO_LYRICS', '未找到歌词');
    reply.type('text/plain; charset=utf-8');
    reply.header('Cache-Control', 'max-age=86400');
    return reply.send(lrc);
  });

  // 清理文件已丢失的媒体库记录
  fastify.post('/api/library/cleanup', async () => {
    const removed = dbOps.cleanupMissingFiles(db);
    return { removed };
  });

  // 在系统文件管理器中打开下载目录
  fastify.post('/api/system/open-download-dir', async () => {
    const { downloadDir } = getSettings(db);
    const ok = openInFileManager(downloadDir);
    if (!ok) throw httpError(500, 'OPEN_FAILED', '当前平台不支持自动打开文件管理器');
    return { ok: true, path: downloadDir };
  });

  // 定位媒体库文件（在文件管理器中选中）
  fastify.post('/api/library/:id/locate', async (req) => {
    const row = dbOps.getFile(db, req.params.id);
    if (!row) throw httpError(404, 'FILE_NOT_FOUND', '文件记录不存在');
    const { downloadDir } = getSettings(db);
    if (!isInsideDownloadDir(row.filePath, downloadDir)) {
      throw httpError(403, 'PATH_DENIED', '文件不在下载目录内，拒绝打开');
    }
    const ok = openInFileManager(row.filePath, { select: true });
    if (!ok) throw httpError(500, 'OPEN_FAILED', '当前平台不支持自动打开文件管理器');
    return { ok: true, path: row.filePath };
  });

  // 删除媒体库记录（可选同时删除磁盘文件）
  fastify.post('/api/library/:id/delete', async (req) => {
    const row = dbOps.getFile(db, req.params.id);
    if (!row) throw httpError(404, 'FILE_NOT_FOUND', '文件记录不存在');
    const removeFile = req.body?.removeFile !== false; // 默认连文件一起删
    let fileRemoved = false;

    if (removeFile) {
      const { downloadDir } = getSettings(db);
      if (!isInsideDownloadDir(row.filePath, downloadDir)) {
        throw httpError(403, 'PATH_DENIED', '文件不在下载目录内，拒绝删除');
      }
      try {
        await rm(row.filePath, { force: true });
        // 侧车歌词一并删除
        await rm(row.filePath.replace(/\.[^.]+$/, '') + '.lrc', { force: true });
        // 歌曲专属文件夹若已空则一并移除（一歌一文件夹结构）
        const dir = path.dirname(row.filePath);
        if (dir !== path.resolve(downloadDir)) {
          await rmdir(dir).catch(() => {});
        }
        fileRemoved = true;
      } catch (e) {
        throw httpError(500, 'DELETE_FAILED', `删除文件失败: ${e.message}`);
      }
    }

    dbOps.deleteFileRecord(db, req.params.id);
    return { ok: true, fileRemoved, title: row.title };
  });

  // ---------- 配置 ----------
  fastify.get('/api/config', async () => {
    const settings = getSettings(db);
    return {
      namingTemplate: settings.namingTemplate,
      downloadDir: settings.downloadDir,
      concurrency: settings.concurrency,
      defaultQuality: settings.defaultQuality,
      fallback: settings.fallback,
      maxRetries: settings.maxRetries,
      qualities: qq.qualityOptions(),
    };
  });

  fastify.put('/api/config', async (req) => {
    const settings = updateSettings(db, req.body ?? {}, { isAllowedQuality: qq.isAllowedQuality });
    return {
      namingTemplate: settings.namingTemplate,
      downloadDir: settings.downloadDir,
      concurrency: settings.concurrency,
      defaultQuality: settings.defaultQuality,
      fallback: settings.fallback,
      maxRetries: settings.maxRetries,
      qualities: qq.qualityOptions(),
    };
  });
}
