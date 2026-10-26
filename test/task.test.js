import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setSetting } from '../src/db.js';
import { isRetryable, runTask, TaskError } from '../src/task.js';
import { createTestDb } from './helpers.js';

const quality = { code: 'M800', label: 'MP3 320', ext: '.mp3' };

function operations(overrides = {}) {
  return {
    getSongDetail: async () => ({ title: '测试歌曲', artist: '测试歌手', album: '测试专辑', cover: '' }),
    resolvePlayUrl: async () => ({ url: 'https://cdn.test/track.mp3', quality, errors: [] }),
    getLyrics: async () => ({ lyric: '[00:00.00]你好', trans: '' }),
    fetchCover: async () => ({ buffer: null, mime: 'image/jpeg' }),
    writeMetadata: async () => {},
    writeSidecarLrc: async () => {},
    fetch: async () => new Response(Buffer.from('abc'), { status: 200, headers: { 'content-length': '3' } }),
    ...overrides,
  };
}

test('任务下载成功后重复执行会命中文件级幂等', async (t) => {
  const { db, dir } = await createTestDb(t);
  setSetting(db, 'download_dir', dir);
  setSetting(db, 'naming_template', '{artist} - {title} [{quality}]/{artist} - {title} [{quality}]');
  const task = {
    mid: 'song-1',
    title: '测试歌曲',
    artist: '测试歌手',
    album: '测试专辑',
    quality: 'M800',
    fallback: true,
  };

  const first = await runTask(task, { db, operations: operations() });
  assert.equal(first.received, 3);
  assert.equal(first.dedupedFile, false);
  assert.equal(await readFile(first.filePath, 'utf8'), 'abc');

  const second = await runTask(task, { db, operations: operations() });
  assert.equal(second.dedupedFile, true);
  assert.equal(second.filePath, first.filePath);
});

test('无直链和 CDN 404 使用正确错误码', async (t) => {
  const { db, dir } = await createTestDb(t);
  setSetting(db, 'download_dir', dir);
  const task = { mid: 'song-2', quality: 'M800', fallback: true };

  await assert.rejects(
    () =>
      runTask(task, {
        db,
        operations: operations({
          resolvePlayUrl: async () => ({ url: '', quality, errors: ['需要 VIP'] }),
        }),
      }),
    (error) => error instanceof TaskError && error.code === 'NO_URL' && !isRetryable(error),
  );

  await assert.rejects(
    () =>
      runTask(task, {
        db,
        operations: operations({
          fetch: async () => new Response('missing', { status: 404 }),
        }),
      }),
    (error) => error instanceof TaskError && error.code === 'DOWNLOAD_HTTP_404' && !isRetryable(error),
  );

  await assert.rejects(() =>
    access(path.join(dir, '测试歌手 - 测试歌曲 [M800]', '测试歌手 - 测试歌曲 [M800].mp3.part')),
  );
});
