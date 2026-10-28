import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import test from 'node:test';
import apiRoutes from '../src/routes/api.js';
import { getFile, insertFile, listFiles, setSetting } from '../src/db.js';
import { saveSidecarCover } from '../src/metadata.js';
import { createTestDb } from './helpers.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function createTestApp(t, { coverRepair } = {}) {
  const { db, dir } = await createTestDb(t);
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('queue', {
    enqueue() {},
    cancel: () => null,
    retry: () => null,
    clearFinished: () => 0,
  });
  if (coverRepair) app.decorate('coverRepair', coverRepair);
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error.statusCode ?? 500).send({
      error: { code: error.code ?? 'INTERNAL', message: error.message },
    });
  });
  await app.register(apiRoutes);
  await app.ready();
  t.after(() => app.close());
  return { app, db, dir };
}

test('健康检查和配置接口返回稳定契约', async (t) => {
  const { app } = await createTestApp(t);

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const config = await app.inject({ method: 'GET', url: '/api/config' });
  assert.equal(config.statusCode, 200);
  assert.equal(typeof config.json().downloadDir, 'string');
  assert.ok(Array.isArray(config.json().qualities));
});

test('关键参数错误和缺失资源返回统一错误码', async (t) => {
  const { app } = await createTestApp(t);

  const search = await app.inject({ method: 'GET', url: '/api/search' });
  assert.equal(search.statusCode, 400);
  assert.equal(search.json().error.code, 'BAD_REQUEST');

  const download = await app.inject({
    method: 'POST',
    url: '/api/downloads',
    payload: { mid: '' },
  });
  assert.equal(download.statusCode, 400);
  assert.equal(download.json().error.code, 'BAD_REQUEST');

  const task = await app.inject({ method: 'GET', url: '/api/tasks/missing' });
  assert.equal(task.statusCode, 404);
  assert.equal(task.json().error.code, 'TASK_NOT_FOUND');
});

test('封面接口优先返回侧车封面，删除文件时同步清理歌词与封面', async (t) => {
  const { app, db, dir } = await createTestApp(t);
  setSetting(db, 'download_dir', dir);
  const audioFile = path.join(dir, '测试歌曲', '测试歌曲.ogg');
  await mkdir(path.dirname(audioFile), { recursive: true });
  await writeFile(audioFile, 'audio');
  await writeFile(audioFile.replace(/\.ogg$/, '.lrc'), '[00:00.00]歌词');
  await saveSidecarCover(audioFile, jpeg, 'image/jpeg');
  insertFile(db, {
    mid: 'cover-song',
    quality: 'O600',
    filePath: audioFile,
    size: 5,
    title: '测试歌曲',
    artist: '测试歌手',
    album: '测试专辑',
  });
  const id = listFiles(db, { limit: 10 }).files[0].id;

  const cover = await app.inject({ method: 'GET', url: `/api/library/${id}/cover` });
  assert.equal(cover.statusCode, 200);
  assert.match(cover.headers['content-type'], /^image\/jpeg/);
  assert.deepEqual(cover.rawPayload, jpeg);

  const deleted = await app.inject({
    method: 'POST',
    url: `/api/library/${id}/delete`,
    payload: { removeFile: true },
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().fileRemoved, true);
  assert.equal(getFile(db, id), null);

  await assert.rejects(() => access(audioFile));
  await assert.rejects(() => access(audioFile.replace(/\.ogg$/, '.lrc')));
  await assert.rejects(() => access(audioFile.replace(/\.ogg$/, '.cover.jpg')));
});

test('媒体库封面回填接口返回统计结果', async (t) => {
  const { app } = await createTestApp(t, {
    coverRepair: async () => ({ total: 3, repaired: 2, skipped: 1, failed: 0 }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/library/covers/refresh',
    payload: {},
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { total: 3, repaired: 2, skipped: 1, failed: 0 });
});
