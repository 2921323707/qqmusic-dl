import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  extractCover,
  extractEmbeddedLyrics,
  readCover,
  readSidecarCover,
  removeSidecarCovers,
  saveSidecarCover,
  writeMetadata,
  writeSidecarLrc,
} from '../src/metadata.js';
import { createTestDb } from './helpers.js';

function createMinimalFlac() {
  const streamInfo = Buffer.alloc(34);
  const streamInfoHeader = Buffer.from([0x80, 0x00, 0x00, 0x22]);
  return Buffer.concat([Buffer.from('fLaC'), streamInfoHeader, streamInfo, Buffer.from([0xff, 0xf8, 0x00, 0x00])]);
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from([1, 2, 3])]);

test('FLAC 标签按规范写入并可读回，侧车歌词使用 LF 换行', async (t) => {
  const { dir } = await createTestDb(t);
  const file = path.join(dir, 'track.flac');
  const cover = Buffer.from([1, 2, 3, 4]);
  await writeFile(file, createMinimalFlac());

  await writeMetadata(
    file,
    {
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      year: '2026',
      lyrics: '[00:00.00]第一行',
    },
    cover,
    'image/png',
  );
  await writeSidecarLrc(file, '第一行\r\n第二行');

  assert.equal(await extractEmbeddedLyrics(file), '[00:00.00]第一行');
  const embeddedCover = await extractCover(file);
  assert.equal(embeddedCover.mime, 'image/png');
  assert.deepEqual(embeddedCover.buffer, cover);
  assert.equal(await readFile(file.replace(/\.flac$/, '.lrc'), 'utf8'), '第一行\n第二行');
});

test('侧车封面支持 JPEG/PNG/WebP，并在格式变化时清理旧文件', async (t) => {
  const { dir } = await createTestDb(t);
  const file = path.join(dir, 'track.ogg');
  await writeFile(file, 'audio');

  const savedJpeg = await saveSidecarCover(file, jpeg, 'image/jpeg');
  assert.equal(path.basename(savedJpeg.path), 'track.cover.jpg');
  assert.deepEqual(await readSidecarCover(file), { buffer: jpeg, mime: 'image/jpeg' });

  await saveSidecarCover(file, png, 'image/png');
  await assert.rejects(() => access(path.join(dir, 'track.cover.jpg')));
  assert.deepEqual(await readSidecarCover(file), { buffer: png, mime: 'image/png' });

  await saveSidecarCover(file, webp, 'image/webp');
  assert.deepEqual(await readSidecarCover(file), { buffer: webp, mime: 'image/webp' });

  await removeSidecarCovers(file);
  for (const ext of ['.cover.jpg', '.cover.png', '.cover.webp']) {
    await assert.rejects(() => access(path.join(dir, `track${ext}`)));
  }
});

test('读取封面时侧车优先于内嵌封面', async (t) => {
  const { dir } = await createTestDb(t);
  const file = path.join(dir, 'track.flac');
  await writeFile(file, createMinimalFlac());
  await writeMetadata(file, { title: '测试' }, png, 'image/png');

  await saveSidecarCover(file, webp, 'image/webp');
  assert.deepEqual(await readCover(file), { buffer: webp, mime: 'image/webp' });

  await removeSidecarCovers(file);
  assert.deepEqual(await readCover(file), { buffer: png, mime: 'image/png' });
});

test('无效 FLAC 会明确失败而不是静默破坏文件', async (t) => {
  const { dir } = await createTestDb(t);
  const file = path.join(dir, 'broken.flac');
  await writeFile(file, 'not-flac');
  await assert.rejects(() => writeMetadata(file, { title: 'x' }, null), /不是有效的 FLAC 文件/);
  assert.equal(await readFile(file, 'utf8'), 'not-flac');
});
