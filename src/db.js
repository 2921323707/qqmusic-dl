/**
 * SQLite 持久层（Node 内置 node:sqlite，无原生依赖）。
 * 表：tasks / files / settings
 */

import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  mid TEXT NOT NULL,
  song_id INTEGER,
  title TEXT,
  artist TEXT,
  album TEXT,
  quality TEXT NOT NULL,
  quality_label TEXT,
  ext TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL DEFAULT 0,
  received INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  file_path TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  fallback INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_mid_quality ON tasks(mid, quality);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mid TEXT NOT NULL,
  quality TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  title TEXT,
  artist TEXT,
  album TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(mid, quality)
);
CREATE INDEX IF NOT EXISTS idx_files_artist ON files(artist);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const now = () => new Date().toISOString();

export function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'qqdl.sqlite'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

// ---------------- tasks ----------------

export function createTask(db, t) {
  const ts = now();
  db.prepare(
    `INSERT INTO tasks (id, mid, song_id, title, artist, album, quality, quality_label, ext,
                        status, progress, received, total, file_path, error, attempts, fallback,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, 0, NULL, NULL, 0, ?, ?, ?)`,
  ).run(
    t.id, t.mid, t.songId ?? null, t.title ?? null, t.artist ?? null, t.album ?? null,
    t.quality, t.qualityLabel ?? null, t.ext ?? null, t.fallback ? 1 : 0, ts, ts,
  );
  return getTask(db, t.id);
}

export function updateTask(db, id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getTask(db, id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  return getTask(db, id);
}

const TASK_COLS = `id, mid, song_id AS songId, title, artist, album, quality, quality_label AS qualityLabel,
  ext, status, progress, received, total, file_path AS filePath, error, attempts, fallback, created_at AS createdAt, updated_at AS updatedAt`;

export function getTask(db, id) {
  return db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(id) ?? null;
}

export function listTasks(db, statuses) {
  // 排序：下载中(0) > 等待/处理中(1) > 已结束(2)（成功/失败/取消）；
  // 批量下载时正在跑的任务置顶，符合用户视线预期。同档内新的在前，
  // 同毫秒批量创建的用 rowid（插入序）做稳定次序
  const order = `ORDER BY CASE status
      WHEN 'downloading' THEN 0
      WHEN 'active' THEN 1
      WHEN 'pending' THEN 1
      ELSE 2
    END,
    created_at DESC, rowid DESC LIMIT 500`;
  if (statuses && statuses.length > 0) {
    const marks = statuses.map(() => '?').join(',');
    return db
      .prepare(`SELECT ${TASK_COLS} FROM tasks WHERE status IN (${marks}) ${order}`)
      .all(...statuses);
  }
  return db.prepare(`SELECT ${TASK_COLS} FROM tasks ${order}`).all();
}

/** 清空已结束的任务记录（成功/失败/取消），进行中的任务不受影响，返回删除条数 */
export function clearFinishedTasks(db) {
  const info = db
    .prepare(`DELETE FROM tasks WHERE status IN ('success', 'failed', 'canceled')`)
    .run();
  return info.changes;
}

/** 领取下一个 pending 任务（置为 active）。同一 mid+quality 已有活动任务时跳过。 */
export function claimNextPending(db, excludedIds = []) {
  const excluded = excludedIds.length
    ? `AND id NOT IN (${excludedIds.map(() => '?').join(',')})`
    : '';
  const row = db
    .prepare(
      `SELECT ${TASK_COLS} FROM tasks
       WHERE status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM tasks t2
           WHERE t2.mid = tasks.mid AND t2.quality = tasks.quality
             AND t2.status IN ('active', 'downloading')
         )
         ${excluded}
       ORDER BY created_at ASC LIMIT 1`,
    )
    .get(...excludedIds);
  if (!row) return null;
  db.prepare(`UPDATE tasks SET status = 'active', updated_at = ? WHERE id = ?`).run(now(), row.id);
  return getTask(db, row.id);
}

export function hasSuccessfulFile(db, mid, quality) {
  return Boolean(db.prepare(`SELECT 1 FROM files WHERE mid = ? AND quality = ?`).get(mid, quality));
}

export function findSuccessfulTask(db, mid, quality) {
  return db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE mid = ? AND quality = ? AND status = 'success'`).get(mid, quality) ?? null;
}

// ---------------- files ----------------

export function insertFile(db, f) {
  db.prepare(
    `INSERT INTO files (mid, quality, file_path, size, title, artist, album, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mid, quality) DO UPDATE SET
       file_path = excluded.file_path, size = excluded.size,
       title = excluded.title, artist = excluded.artist, album = excluded.album`,
  ).run(f.mid, f.quality, f.filePath, f.size ?? 0, f.title ?? null, f.artist ?? null, f.album ?? null, now());
}

export function getFile(db, id) {
  return (
    db
      .prepare(
        `SELECT id, mid, quality, file_path AS filePath, size, title, artist, album, created_at AS createdAt
         FROM files WHERE id = ?`,
      )
      .get(id) ?? null
  );
}

/** 查询某歌曲（mid）已入库的全部文件记录（含磁盘存在性） */
export function listFilesByMid(db, mid) {
  const rows = db
    .prepare(
      `SELECT id, mid, quality, file_path AS filePath, size, title, artist, album, created_at AS createdAt
       FROM files WHERE mid = ? ORDER BY id DESC`,
    )
    .all(mid);
  for (const row of rows) {
    try {
      statSync(row.filePath);
      row.exists = true;
    } catch {
      row.exists = false;
    }
  }
  return rows;
}

export function listFiles(db, { q, limit = 100, offset = 0 }) {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM files`).get().n;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT id, mid, quality, file_path AS filePath, size, title, artist, album, created_at AS createdAt
         FROM files WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(like, like, like, limit, offset);
  } else {
    rows = db
      .prepare(
        `SELECT id, mid, quality, file_path AS filePath, size, title, artist, album, created_at AS createdAt
         FROM files ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);
  }
  // 文件存在性探测（磁盘上的文件可能被外部移动/删除）
  for (const row of rows) {
    try {
      statSync(row.filePath);
      row.exists = true;
    } catch {
      row.exists = false;
    }
  }
  return { total, files: rows };
}

/** 删除一条媒体库记录（文件已丢失时的清理） */
export function deleteFileRecord(db, id) {
  return db.prepare(`DELETE FROM files WHERE id = ?`).run(id).changes > 0;
}

/** 清理所有文件已丢失的媒体库记录，返回清理条数 */
export function cleanupMissingFiles(db) {
  const rows = db.prepare(`SELECT id, file_path AS filePath FROM files`).all();
  let removed = 0;
  for (const row of rows) {
    try {
      statSync(row.filePath);
    } catch {
      db.prepare(`DELETE FROM files WHERE id = ?`).run(row.id);
      removed++;
    }
  }
  return removed;
}

// ---------------- settings ----------------

export function getSetting(db, key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

export function getAllSettings(db) {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** 若命名模板仍是旧版默认值（平铺），则升级为“一歌一文件夹”默认值 */
export function migrateNamingTemplate(db) {
  const OLD_DEFAULT = '{artist} - {title} [{quality}]';
  const NEW_DEFAULT = '{artist} - {title} [{quality}]/{artist} - {title} [{quality}]';
  const current = getSetting(db, 'naming_template');
  if (current === null || current === OLD_DEFAULT) {
    setSetting(db, 'naming_template', NEW_DEFAULT);
    return NEW_DEFAULT;
  }
  return current; // 用户自定义过，保留
}
