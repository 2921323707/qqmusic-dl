import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repairLibraryCovers } from '../src/cover-repair.js';
import { insertFile } from '../src/db.js';
import { readCover, saveSidecarCover } from '../src/metadata.js';
import { createTestDb } from './helpers.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test('旧媒体库封面回填只处理缺封面文件并隔离失败', async (t) => {
  const { db, dir } = await createTestDb(t);
  await mkdir(path.join(dir, 'library'), { recursive: true });

  const existingFile = path.join(dir, 'library', 'existing.ogg');
  const repairableFile = path.join(dir, 'library', 'repairable.ogg');
  const failedFile = path.join(dir, 'library', 'failed.ogg');
  await Promise.all([writeFile(existingFile, 'a'), writeFile(repairableFile, 'b'), writeFile(failedFile, 'c')]);
  await saveSidecarCover(existingFile, jpeg, 'image/jpeg');

  insertFile(db, {
    mid: 'existing',
    quality: 'O600',
    filePath: existingFile,
    size: 1,
    title: '已有封面',
    artist: '测试',
    album: '测试',
  });
  insertFile(db, {
    mid: 'repairable',
    quality: 'O600',
    filePath: repairableFile,
    size: 1,
    title: '待修复',
    artist: '测试',
    album: '测试',
  });
  insertFile(db, {
    mid: 'failed',
    quality: 'O600',
    filePath: failedFile,
    size: 1,
    title: '无封面源',
    artist: '测试',
    album: '测试',
  });
  insertFile(db, {
    mid: 'missing',
    quality: 'O600',
    filePath: path.join(dir, 'library', 'missing.ogg'),
    size: 1,
    title: '文件缺失',
    artist: '测试',
    album: '测试',
  });

  const detailMids = [];
  const result = await repairLibraryCovers(db, {
    concurrency: 2,
    operations: {
      readCover,
      saveSidecarCover,
      getSongDetail: async (mid) => {
        detailMids.push(mid);
        return mid === 'repairable' ? { cover: 'https://cdn.test/repairable.jpg' } : null;
      },
      fetchCover: async (url) => (url ? { buffer: jpeg, mime: 'image/jpeg' } : { buffer: null, mime: 'image/jpeg' }),
    },
  });

  assert.deepEqual(result, { total: 4, repaired: 1, skipped: 2, failed: 1 });
  assert.deepEqual(detailMids.sort(), ['failed', 'repairable']);
  await access(path.join(dir, 'library', 'repairable.cover.jpg'));
});
