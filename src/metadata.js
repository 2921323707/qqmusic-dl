/**
 * 元数据写入：
 *  - FLAC: 自实现 VORBIS_COMMENT + PICTURE 块重写
 *  - MP3 : node-id3（ID3v2）
 *  - OGG : 跳过容器内嵌标签（写侧车 LRC）
 *  - M4A/MP4: 跳过容器内嵌标签（写侧车 LRC）
 *  - 所有格式: 侧车 .lrc
 */

import path from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import NodeID3 from 'node-id3';

// ---------------- FLAC ----------------

const FLAC_MAGIC = Buffer.from('fLaC');
const BLOCK_VORBIS_COMMENT = 4;
const BLOCK_PICTURE = 6;

/** 读取 FLAC 元数据块序列，返回 { blocks: [{type, data}], audioStart } */
function parseFlacBlocks(buf) {
  if (!buf.subarray(0, 4).equals(FLAC_MAGIC)) throw new Error('不是有效的 FLAC 文件');
  const blocks = [];
  let pos = 4;
  for (;;) {
    if (pos + 4 > buf.length) throw new Error('FLAC 元数据损坏');
    const header = buf[pos];
    const isLast = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const start = pos + 4;
    const end = start + len;
    if (end > buf.length) throw new Error('FLAC 元数据块长度越界');
    blocks.push({ type, data: buf.subarray(start, end) });
    pos = end;
    if (isLast) break;
  }
  return { blocks, audioStart: pos };
}

/** 构造 VORBIS_COMMENT 块数据 */
function buildVorbisComment({ title, artist, album, year, lyrics }) {
  const vendor = 'qqmusic-dl';
  const comments = [];
  if (title) comments.push(`TITLE=${title}`);
  if (artist) comments.push(`ARTIST=${artist}`);
  if (album) comments.push(`ALBUM=${album}`);
  if (year) comments.push(`DATE=${year}`);
  if (lyrics) comments.push(`LYRICS=${lyrics.replace(/\r\n/g, '\n')}`);

  const parts = [];
  const pushU32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    parts.push(b);
  };
  pushU32(Buffer.byteLength(vendor, 'utf8'));
  parts.push(Buffer.from(vendor, 'utf8'));
  pushU32(comments.length);
  for (const c of comments) {
    pushU32(Buffer.byteLength(c, 'utf8'));
    parts.push(Buffer.from(c, 'utf8'));
  }
  parts.push(Buffer.from([0x01])); // framing bit
  return Buffer.concat(parts);
}

/** 构造 PICTURE 块数据（封面）。注意：FLAC 元数据块字段为大端序（BE） */
function buildFlacPicture(cover, mime) {
  const parts = [];
  const pushU32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v >>> 0, 0);
    parts.push(b);
  };
  pushU32(3); // picture type: front cover
  pushU32(Buffer.byteLength(mime, 'ascii'));
  parts.push(Buffer.from(mime, 'ascii'));
  pushU32(0); // description length
  pushU32(0); // width
  pushU32(0); // height
  pushU32(0); // color depth
  pushU32(0); // indexed colors
  pushU32(cover.length);
  parts.push(cover);
  return Buffer.concat(parts);
}

function serializeFlac(blocks, audio) {
  const out = [FLAC_MAGIC];
  blocks.forEach((b, i) => {
    const isLast = i === blocks.length - 1;
    const header = Buffer.alloc(4);
    header[0] = (isLast ? 0x80 : 0) | (b.type & 0x7f);
    header[1] = (b.data.length >> 16) & 0xff;
    header[2] = (b.data.length >> 8) & 0xff;
    header[3] = b.data.length & 0xff;
    out.push(header, b.data);
  });
  out.push(audio);
  return Buffer.concat(out);
}

/** 重写 FLAC 标签（原子替换） */
async function writeFlacTags(file, tags, cover, mime) {
  const buf = await readFile(file);
  const { blocks, audioStart } = parseFlacBlocks(buf);
  const kept = blocks.filter((b) => b.type !== BLOCK_VORBIS_COMMENT && b.type !== BLOCK_PICTURE);
  const newBlocks = [...kept];
  if (cover?.length) newBlocks.push({ type: BLOCK_PICTURE, data: buildFlacPicture(cover, mime) });
  newBlocks.push({ type: BLOCK_VORBIS_COMMENT, data: buildVorbisComment(tags) });
  const out = serializeFlac(newBlocks, buf.subarray(audioStart));
  const tmp = `${file}.tmp`;
  await writeFile(tmp, out);
  await rename(tmp, file);
}

// ---------------- MP3 ----------------

async function writeMp3Tags(file, tags, cover, mime) {
  const id3 = {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    year: tags.year,
  };
  if (cover?.length) {
    id3.image = { mime, imageBuffer: cover, type: { id: 3, name: 'front cover' } };
  }
  if (tags.lyrics) {
    id3.unsynchronisedLyrics = { language: 'chi', text: tags.lyrics };
  }
  const ok = NodeID3.update(id3, file);
  if (!ok) throw new Error('node-id3 写入失败');
}

// ---------------- 对外 ----------------

/**
 * 写入元数据（尽力而为，失败抛错由调用方决定是否降级）。
 * @param {string} file 音频文件路径
 * @param {{title:string, artist:string, album:string, year:string, lyrics:string}} tags
 * @param {Buffer|null} cover 封面二进制
 * @param {string} mime 封面 MIME
 */
export async function writeMetadata(file, tags, cover, mime = 'image/jpeg') {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.flac') return writeFlacTags(file, tags, cover, mime);
  if (ext === '.mp3') return writeMp3Tags(file, tags, cover, mime);
  // .ogg / .m4a / .mp4 等：容器内嵌标签暂不支持
  return { skipped: ext };
}

/** 写侧车 LRC 歌词文件 */
export async function writeSidecarLrc(file, lrcText) {
  if (!lrcText || !lrcText.trim()) return;
  const lrcPath = file.replace(/\.[^.]+$/, '') + '.lrc';
  await writeFile(lrcPath, lrcText.replace(/\r\n/g, '\n'), 'utf8');
}

/** 下载封面（失败返回 null） */
export async function fetchCover(url) {
  if (!url) return { buffer: null, mime: 'image/jpeg' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { buffer: null, mime: 'image/jpeg' };
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) return { buffer: null, mime: ct };
    return { buffer, mime: ct.split(';')[0] };
  } catch {
    return { buffer: null, mime: 'image/jpeg' };
  }
}

/**
 * 从音频文件提取嵌入歌词。
 * MP3：ID3 unsynchronisedLyrics；FLAC：VORBIS_COMMENT 的 LYRICS 字段。
 * @returns {Promise<string>} LRC 文本，无则返回空串
 */
export async function extractEmbeddedLyrics(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.mp3') {
      const tags = NodeID3.read(file);
      const text = tags?.unsynchronisedLyrics?.text;
      return typeof text === 'string' ? text : '';
    }
    if (ext === '.flac') {
      const buf = await readFile(file);
      if (!buf.subarray(0, 4).equals(FLAC_MAGIC)) return '';
      const { blocks } = parseFlacBlocks(buf);
      const vc = blocks.find((b) => b.type === BLOCK_VORBIS_COMMENT);
      if (!vc) return '';
      const d = vc.data;
      // Vorbis comment：vendor 长度(LE) + vendor + 条数(LE) + 每条(长度LE + "KEY=value")
      const vendorLen = d.readUInt32LE(0);
      let p = 4 + vendorLen;
      const count = d.readUInt32LE(p);
      p += 4;
      for (let i = 0; i < count && p + 4 <= d.length; i++) {
        const len = d.readUInt32LE(p);
        p += 4;
        const comment = d.subarray(p, p + len).toString('utf8');
        p += len;
        if (comment.startsWith('LYRICS=')) return comment.slice(7);
      }
    }
  } catch {
    /* 读取失败按无歌词处理 */
  }
  return '';
}

/**
 * 从音频文件提取嵌入的封面（优先取文件内嵌图，不依赖外链）。
 * MP3 走 node-id3 读标签；FLAC 解析 PICTURE 元数据块。
 * @returns {Promise<{buffer: Buffer|null, mime: string}>}
 */
export async function extractCover(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.mp3') {
      const tags = NodeID3.read(file);
      const img = tags?.image;
      if (img?.imageBuffer) {
        return { buffer: Buffer.from(img.imageBuffer), mime: img.mime || 'image/jpeg' };
      }
      return { buffer: null, mime: 'image/jpeg' };
    }
    if (ext === '.flac') {
      const buf = await readFile(file);
      if (!buf.subarray(0, 4).equals(FLAC_MAGIC)) return { buffer: null, mime: 'image/jpeg' };
      const { blocks } = parseFlacBlocks(buf);
      const pic = blocks.find((b) => b.type === BLOCK_PICTURE);
      if (!pic) return { buffer: null, mime: 'image/jpeg' };
      const d = pic.data;
      let p = 4;
      const mimeLen = d.readUInt32BE(p);
      p += 4;
      const mime = d.subarray(p, p + mimeLen).toString('ascii') || 'image/jpeg';
      p += mimeLen;
      const descLen = d.readUInt32BE(p);
      p += 4 + descLen;
      p += 16; // width / height / depth / indexed colors（均为 BE）
      const dataLen = d.readUInt32BE(p);
      p += 4;
      return { buffer: d.subarray(p, p + dataLen), mime };
    }
  } catch {
    /* 读取失败按无封面处理 */
  }
  return { buffer: null, mime: 'image/jpeg' };
}
