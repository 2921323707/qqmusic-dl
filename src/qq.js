/**
 * QQ 音乐适配层：对 vendor/QQMusicapi 的薄封装。
 * 集中处理：音质阶梯、搜索解析、详情解析、取链（含降级）、歌词解密。
 * 上游字段变化只需改这里。
 */

import path from 'node:path';
import { config } from './config.js';
import { Client } from '../vendor/QQMusicapi/src/client.js';
import { Platform } from '../vendor/QQMusicapi/src/versioning.js';
import { qrcDecrypt } from '../vendor/QQMusicapi/src/algorithms/qrc.js';
import { qrcToLrc } from './util/lyrics.js';

/** 有序音质阶梯（高 -> 低）。TL01(.nac) 为专有加密格式，默认禁用。 */
export const QUALITY_LADDER = [
  { code: 'AI00', label: '臻品母带', ext: '.flac' },
  { code: 'Q000', label: '臻品音质', ext: '.flac' },
  { code: 'Q001', label: '臻品全景声 5.1', ext: '.flac' },
  { code: 'Q003', label: '臻品全景声 7.1', ext: '.ogg' },
  { code: 'DT03', label: 'DTS:X', ext: '.mp4' },
  { code: 'D004', label: '杜比全景声', ext: '.mp4' },
  { code: 'F000', label: 'SQ 无损', ext: '.flac' },
  { code: 'O801', label: 'OGG 640', ext: '.ogg' },
  { code: 'O800', label: 'OGG 320', ext: '.ogg' },
  { code: 'O600', label: 'OGG 192', ext: '.ogg' },
  { code: 'O400', label: 'OGG 96', ext: '.ogg' },
  { code: 'M800', label: 'MP3 320', ext: '.mp3' },
  { code: 'M500', label: 'MP3 128', ext: '.mp3' },
  { code: 'C600', label: 'AAC 192', ext: '.m4a' },
  { code: 'C400', label: 'AAC 96', ext: '.m4a' },
  { code: 'C200', label: 'AAC 48', ext: '.m4a' },
];

export const QUALITY_BY_CODE = new Map(QUALITY_LADDER.map((q) => [q.code, q]));

/** AUTO 伪音质：取该歌曲实际可用的最高音质（解决不同歌曲最高音质不同的问题） */
export const AUTO_QUALITY = { code: 'AUTO', label: '最高可用', ext: '' };

export function isAllowedQuality(code) {
  return code === 'AUTO' || QUALITY_BY_CODE.has(code);
}

/** 配置接口/前端下拉用的音质列表（AUTO 置顶） */
export function qualityOptions() {
  return [AUTO_QUALITY, ...QUALITY_LADDER];
}

/** 音质等级（越大越高）；AUTO 或未知返回 -1 */
export function qualityRank(code) {
  if (!code || code === 'AUTO') return -1;
  const idx = QUALITY_LADDER.findIndex((q) => q.code === code);
  return idx === -1 ? -1 : QUALITY_LADDER.length - idx;
}

/** 从阶梯顶点（含）开始的降级链 */
export function fallbackChain(fromCode) {
  const idx = QUALITY_LADDER.findIndex((q) => q.code === fromCode);
  if (idx === -1) return QUALITY_LADDER; // 未命中（如 AUTO）则从最高开始
  return QUALITY_LADDER.slice(idx);
}

let _client = null;

export function getClient() {
  if (!_client) {
    _client = new Client({
      platform: Platform.ANDROID,
      devicePath: path.join(config.dataDir, 'device.json'),
    });
  }
  return _client;
}

// ---------------- 解析辅助 ----------------

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function joinSingers(singers) {
  if (!Array.isArray(singers)) return '';
  const names = singers
    .map((s) => firstString(s?.name, s?.title))
    .filter(Boolean);
  // 去重保序
  return [...new Set(names)].join(' / ');
}

/** 解析单首歌曲项（兼容搜索现代格式与歌单经典格式），供歌单模块复用 */
export function parseSongListItem(rawItem) {
  const item = normalizeSongItem(rawItem);
  const album = item.album ?? {};
  const file = item.file ?? {};
  return {
    mid: firstString(item.mid, item.songmid),
    songId: Number(item.id ?? item.song_id ?? 0) || null,
    title: stripHighlight(firstString(item.title, item.name)),
    artist: stripHighlight(joinSingers(item.singer)),
    album: stripHighlight(firstString(album.title, album.name)),
    albumMid: firstString(album.mid, album.pmid),
    duration: Number(item.interval ?? 0) || 0,
    cover: coverUrl(firstString(album.mid, album.pmid)),
    qualities: qualitiesFromFileSize(file),
    _raw: file,
  };
}

function coverUrl(albumMid) {
  if (!albumMid) return null;
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
}

/** 去掉搜索接口返回的高亮 HTML 标记（如 <em>关键词</em>），只留纯文本 */
function stripHighlight(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '');
}

/**
 * 将“经典格式”歌单歌曲项（songmid/songname/albumname/size128…）
 * 归一化为搜索接口的现代格式（mid/title/album/file.size_*），
 * 现代格式原样返回。
 */
function normalizeSongItem(item) {
  if (item == null || typeof item !== 'object') return item;
  if (item.mid || item.songmid == null) return item; // 已是现代格式
  const size = {};
  if (item.size128) size.size_128mp3 = item.size128;
  if (item.size320) size.size_320mp3 = item.size320;
  if (item.sizeflac) size.size_flac = item.sizeflac;
  if (item.sizeape) size.size_ape = item.sizeape;
  if (item.sizeogg) size.size_192ogg = item.sizeogg;
  if (item.size5_1) size.size_aac = item.size5_1;
  return {
    mid: item.songmid,
    id: item.songid,
    title: item.songname || item.songorig,
    name: item.songname || item.songorig,
    singer: item.singer,
    album: { name: item.albumname, title: item.albumname, mid: item.albummid },
    interval: item.interval,
    file: size,
    _mediaMid: item.strMediaMid,
  };
}

/** best-effort 音质可用性（源自详情 file.size_* 字段；未知返回 null） */
function qualitiesFromFileSize(file) {
  const size = (k) => Number(file?.[k] ?? 0) || 0;
  const map = {
    M500: size('size_128mp3'),
    M800: size('size_320mp3'),
    F000: Math.max(size('size_flac'), size('size_ape')),
    O600: size('size_192ogg'),
    O400: size('size_96ogg'),
    C600: size('size_192aac'),
    C400: size('size_96aac'),
    C200: size('size_48aac'),
  };
  const out = [];
  for (const q of QUALITY_LADDER) {
    if (map[q.code] !== undefined) out.push(map[q.code] > 0 ? q.code : null);
    else out.push(null);
  }
  return out.filter(Boolean);
}

// ---------------- 对外 API ----------------

/** 搜索歌曲 */
export async function searchSongs(keyword, page = 1, num = 20) {
  const client = getClient();
  const data = await client.search.generalSearch(keyword, page, num);
  const body = data?.body ?? {};
  const list =
    body?.item_song?.items ??
    body?.item_song?.list ??
    body?.song?.list ??
    body?.songlist?.list ??
    [];
  const songs = (Array.isArray(list) ? list : []).map(parseSongListItem).filter((s) => s.mid);
  return songs;
}

/** 歌曲详情 */
export async function getSongDetail(mid) {
  const client = getClient();
  const { tracks } = await client.song.getDetail([mid]);
  const t = tracks?.[0];
  if (!t) return null;
  const parsed = parseSongListItem(t);
  return parsed;
}

/**
 * 校验直链是否真实可下载（Range 探针）。
 * 背景：臻品系音质（AI00/Q000/Q001/Q003/DT03/D004）走加密通道，
 * 普通取链接口会返回"假 purl"——URL 能拼出来但 CDN 上文件不存在（404）。
 * 因此拿到 purl 后必须验证，无效则交由降级链继续尝试。
 */
async function probeUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': 'Mozilla/5.0', Referer: 'https://y.qq.com/' },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * 解析播放直链。目标音质无权限时按 fallback 沿阶梯降级。
 * 每个候选直链都会做真实性探针（防臻品系假链 404）。
 * @returns {{quality: object, url: string, errors: string[]}}
 */
export async function resolvePlayUrl(mid, qualityCode, { fallback = true } = {}) {
  const client = getClient();
  // AUTO 语义即“从最高开始逐级尝试”，无视 fallback 开关
  const chain =
    qualityCode === 'AUTO'
      ? QUALITY_LADDER
      : fallback
        ? fallbackChain(qualityCode)
        : [QUALITY_BY_CODE.get(qualityCode)].filter(Boolean);
  const errors = [];
  for (const q of chain) {
    let map;
    try {
      map = await client.song.getPlayUrls([mid], q.code);
    } catch (e) {
      errors.push(`${q.label}: ${e.message}`);
      continue;
    }
    const info = map?.[String(mid)];
    if (!info?.url) {
      errors.push(`${q.label}: ${info?.error || '无可用直链'}`);
      continue;
    }
    // 直链真实性探针：失败（如臻品系假链 404）则继续降级
    if (!(await probeUrl(info.url))) {
      errors.push(`${q.label}: 直链无效（CDN 无此文件，可能需加密通道）`);
      continue;
    }
    return { quality: q, url: info.url, errors };
  }
  return { quality: null, url: '', errors };
}

/** 歌词（QRC 解密并转换为标准 LRC 文本，失败不影响主流程） */
export async function getLyrics(mid) {
  const client = getClient();
  try {
    const data = await client.song.getLyrics(mid, { trans: true, roma: false, qrc: true });
    const out = {};
    try {
      out.lyric = data?.lyric ? qrcToLrc(qrcDecrypt(data.lyric)) : '';
    } catch { /* ignore */ }
    try {
      out.trans = data?.trans ? qrcToLrc(qrcDecrypt(data.trans)) : '';
    } catch { /* ignore */ }
    return out;
  } catch {
    return { lyric: '', trans: '' };
  }
}

/** 当前登录态是否可能拿到 VIP 音质（粗判） */
export function hasLogin() {
  const c = getClient();
  return Boolean(c.credential?.isLoggedIn?.() ?? (c.credential?.musicid && c.credential?.musickey));
}
