/**
 * 单个下载任务的编排：详情 -> 取链(降级) -> 命名 -> 流式下载 -> 元数据。
 */

import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { getSongDetail, resolvePlayUrl, getLyrics } from './qq.js';
import { renderTemplate } from './util/naming.js';
import { writeMetadata, writeSidecarLrc, fetchCover } from './metadata.js';
import { getSettings } from './settings.js';

export class TaskError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/** 不可重试的错误码 */
const PERMANENT = new Set(['ABORTED', 'NO_URL', 'SONG_NOT_FOUND', 'CONFIG_INVALID', 'DOWNLOAD_HTTP_404']);
export function isRetryable(e) {
  if (e instanceof TaskError) return !PERMANENT.has(e.code);
  return true; // 网络类错误默认重试
}

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/** 流式下载到 dest（先写 .part 再原子改名），进度回调 received/total */
async function streamDownload(url, dest, { onProgress, signal }) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://y.qq.com/',
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]),
  });
  if (!res.ok || !res.body) {
    // 404 = 文件不存在（如臻品系假链），重试无意义
    const code = res.status === 404 ? 'DOWNLOAD_HTTP_404' : 'DOWNLOAD_HTTP';
    throw new TaskError(code, `下载失败: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length') || 0);
  const tmp = `${dest}.part`;
  await mkdir(path.dirname(dest), { recursive: true });

  let received = 0;
  const ws = createWriteStream(tmp);
  // 中止/失败时 destroy 写流会异步 emit 'error'（ERR_STREAM_DESTROYED），
  // 无监听器会导致进程崩溃；这里主动吞掉（清理逻辑在 catch 中）
  ws.on('error', () => {});
  try {
    for await (const chunk of res.body) {
      if (signal?.aborted) throw new TaskError('ABORTED', '已取消');
      ws.write(chunk);
      received += chunk.length;
      onProgress?.(received, total);
    }
    await new Promise((resolve, reject) => {
      ws.end((err) => (err ? reject(err) : resolve()));
    });
    await rename(tmp, dest);
  } catch (e) {
    ws.destroy();
    await rm(tmp, { force: true });
    if (e instanceof TaskError) throw e;
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
      throw new TaskError('ABORTED', signal?.aborted ? '已取消' : '下载超时');
    }
    throw new TaskError('DOWNLOAD_FAILED', `下载中断: ${e.message}`);
  }
  return { received, total };
}

/**
 * 执行下载任务。
 * @returns {Promise<{filePath: string, quality: object, received: number, total: number, dedupedFile: boolean}>}
 */
export async function runTask(task, { db, onProgress, signal }) {
  const settings = getSettings(db);

  // 1. 详情
  const detail = await getSongDetail(task.mid);
  if (!detail) throw new TaskError('SONG_NOT_FOUND', `获取歌曲详情失败: ${task.mid}`);

  // 2. 取链（按需降级）
  const resolved = await resolvePlayUrl(task.mid, task.quality, {
    fallback: task.fallback ? settings.fallback : false,
  });
  if (!resolved.url) {
    throw new TaskError(
      'NO_URL',
      `无可用直链: ${resolved.errors.join('; ')}`,
      '该音质可能需要 VIP 或单独购买，可尝试其他音质',
    );
  }

  // 3. 目标路径
  const vars = {
    artist: detail.artist || task.artist || '未知歌手',
    title: detail.title || task.title || '未知歌曲',
    album: detail.album || task.album || '未知专辑',
    quality: resolved.quality.code,
    year: '',
  };
  const dest = renderTemplate(settings.namingTemplate, vars, settings.downloadDir) + resolved.quality.ext;

  // 幂等：目标文件已存在
  if (await fileExists(dest)) {
    return { filePath: dest, quality: resolved.quality, received: 0, total: 0, dedupedFile: true };
  }

  // 4. 下载
  const { received, total } = await streamDownload(resolved.url, dest, { onProgress, signal });

  // 5. 元数据（尽力而为，失败不影响下载结果）
  try {
    const { lyric, trans } = await getLyrics(task.mid);
    const lrc = [lyric, trans].filter(Boolean).join('\n\n');
    const { buffer, mime } = await fetchCover(detail.cover);
    await writeMetadata(
      dest,
      {
        title: vars.title,
        artist: vars.artist,
        album: vars.album,
        year: vars.year,
        lyrics: lrc,
      },
      buffer,
      mime,
    );
    await writeSidecarLrc(dest, lrc);
  } catch (e) {
    console.warn(`[task] 元数据写入失败(${path.basename(dest)}): ${e.message}`);
  }

  return { filePath: dest, quality: resolved.quality, received, total, dedupedFile: false };
}
