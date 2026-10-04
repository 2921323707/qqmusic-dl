/**
 * 歌单解析：拉取 QQ 音乐歌单（含他人公开歌单）的详情与歌曲列表。
 * 使用公开接口 fcg_ucc_getcdinfo_byids_cp.fcg（带 Referer，无需登录）。
 */

const PLAYLIST_API = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export class PlaylistError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/**
 * 从用户输入提取歌单 tid。
 * 支持：完整分享链接（y.qq.com/n/ryqq_v2/playlist/123、y.qq.com/playlist/123、i.y.qq.com/...）
 *      URL query 中的 id 参数、纯数字 tid。
 */
export function extractPlaylistId(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/^\d{4,}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const m = u.pathname.match(/playlist\/(\d+)/);
    if (m) return m[1];
    const q = u.searchParams.get('id');
    if (q && /^\d{4,}$/.test(q)) return q;
  } catch {
    /* 非 URL */
  }
  return null;
}

/** 防御性 JSON 解析（兼容可能的 JSONP 包装） */
function parseMaybeJsonp(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        /* fallthrough */
      }
    }
    return null;
  }
}

/**
 * 封面地址规范化：QQ 图片域名均支持 https，统一升级。
 * 歌单接口返回的 logo 常为 http://，原生壳的 WKWebView 受 ATS 限制
 * 会拦截外部 http 资源，导致封面显示为破图。
 */
function normalizeCover(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' && /(^|\.)(qq\.com|gtimg\.cn)$/i.test(u.hostname)) {
      u.protocol = 'https:';
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * 拉取歌单详情与歌曲列表。
 * @param {string} input 歌单链接或 tid
 * @param {(item: object) => object} parseItem 歌曲解析器（由 qq.js 注入，避免循环依赖）
 * @returns {Promise<{id, title, cover, creator, trackCount, songs: object[]}>}
 */
export async function resolvePlaylist(input, parseItem) {
  const tid = extractPlaylistId(input);
  if (!tid) {
    throw new PlaylistError(
      'BAD_PLAYLIST_INPUT',
      '无法识别歌单链接或 ID',
      '支持形如 https://y.qq.com/n/ryqq_v2/playlist/8740590963 的链接或纯数字歌单 ID',
    );
  }

  const url = `${PLAYLIST_API}?disstid=${encodeURIComponent(tid)}&type=1&json=1&utf8=1&onlysong=0&format=json`;
  let data;
  try {
    const res = await fetch(url, {
      headers: { Referer: `https://y.qq.com/n/ryqq/playlist/${tid}`, 'User-Agent': UA },
    });
    data = parseMaybeJsonp(await res.text());
  } catch (e) {
    throw new PlaylistError('PLAYLIST_NETWORK', `歌单接口请求失败: ${e.message}`);
  }

  const cd = data?.cdlist?.[0];
  if (!cd) {
    throw new PlaylistError(
      'PLAYLIST_NOT_FOUND',
      `歌单不存在或无权访问（ID: ${tid}）`,
      '请确认链接有效；部分歌单可能已被删除或设为私密',
    );
  }

  const list = Array.isArray(cd.songlist) ? cd.songlist : Array.isArray(cd.list) ? cd.list : [];
  const songs = list.map(parseItem).filter((s) => s && s.mid);
  return {
    id: String(tid),
    title: cd.dissname || `歌单 ${tid}`,
    cover: normalizeCover(cd.logo),
    creator: cd.nickname || null,
    trackCount: Number(cd.songnum) || songs.length,
    songs,
  };
}
