import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import * as dbOps from '../src/db.js';
import { updateSettings } from '../src/settings.js';
import { createTask, createTestDb } from './helpers.js';

test('任务状态、领取和媒体库记录可持久化', async (t) => {
  const { db, dir } = await createTestDb(t);

  const first = dbOps.createTask(db, createTask('task-1', { mid: 'song-1' }));
  assert.equal(first.status, 'pending');
  assert.equal(first.fallback, 1);

  const claimed = dbOps.claimNextPending(db);
  assert.equal(claimed.id, 'task-1');
  assert.equal(claimed.status, 'active');

  dbOps.createTask(db, createTask('task-2', { mid: 'song-1' }));
  assert.equal(dbOps.claimNextPending(db), null);

  dbOps.updateTask(db, 'task-1', { status: 'success' });
  assert.equal(dbOps.claimNextPending(db).id, 'task-2');

  const filePath = path.join(dir, 'song.mp3');
  dbOps.insertFile(db, {
    mid: 'song-1',
    quality: 'M800',
    filePath,
    size: 10,
    title: '测试歌曲',
    artist: '测试歌手',
    album: '测试专辑',
  });
  dbOps.insertFile(db, {
    mid: 'song-1',
    quality: 'M800',
    filePath,
    size: 20,
    title: '测试歌曲',
    artist: '测试歌手',
    album: '测试专辑',
  });

  assert.equal(dbOps.hasSuccessfulFile(db, 'song-1', 'M800'), true);
  const files = dbOps.listFilesByMid(db, 'song-1');
  assert.equal(files.length, 1);
  assert.equal(files[0].size, 20);
  assert.equal(files[0].exists, false);

  assert.equal(dbOps.cleanupMissingFiles(db), 1);
  assert.equal(dbOps.listFiles(db, { q: '' }).total, 0);
});

test('设置校验和命名模板迁移保持兼容', async (t) => {
  const { db } = await createTestDb(t);

  dbOps.setSetting(db, 'naming_template', '{artist} - {title} [{quality}]');
  const migrated = dbOps.migrateNamingTemplate(db);
  assert.equal(migrated, '{artist} - {title} [{quality}]/{artist} - {title} [{quality}]');

  dbOps.setSetting(db, 'naming_template', '{album}/{title}');
  assert.equal(dbOps.migrateNamingTemplate(db), '{album}/{title}');

  const updated = updateSettings(
    db,
    { concurrency: 3, fallback: false, defaultQuality: 'M800' },
    { isAllowedQuality: (quality) => quality === 'M800' },
  );
  assert.equal(updated.concurrency, 3);
  assert.equal(updated.fallback, false);
  assert.equal(updated.defaultQuality, 'M800');

  assert.throws(
    () => updateSettings(db, { unknown: true }, { isAllowedQuality: () => true }),
    (error) => error.statusCode === 400 && error.code === 'CONFIG_INVALID',
  );
});
