import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';

export async function createTestDb(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qqmusic-dl-test-'));
  const db = openDatabase(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { db, dir };
}

export async function waitFor(predicate, { timeoutMs = 1500, intervalMs = 10 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`等待条件超时（${timeoutMs}ms）`);
}

export function createTask(id, overrides = {}) {
  return {
    id,
    mid: overrides.mid ?? id,
    title: overrides.title ?? `歌曲 ${id}`,
    artist: overrides.artist ?? '测试歌手',
    album: overrides.album ?? '测试专辑',
    quality: overrides.quality ?? 'M800',
    qualityLabel: overrides.qualityLabel ?? 'MP3 320',
    ext: overrides.ext ?? '.mp3',
    fallback: overrides.fallback ?? true,
  };
}
