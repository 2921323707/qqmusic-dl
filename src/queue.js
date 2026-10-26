/**
 * 下载队列：内存调度 + SQLite 持久化。
 * - 并发受 settings.concurrency 控制
 * - 失败指数退避重试（maxRetries 次）
 * - 支持取消（AbortController）与重试入队
 * - 重启时 active/downloading 任务重置为 pending 重新入队
 */

import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import * as dbOps from './db.js';
import { getSettings } from './settings.js';
import { runTask, isRetryable } from './task.js';

const ACTIVE_STATUSES = ['active', 'downloading'];

export class DownloadQueue {
  constructor(
    db,
    {
      taskRunner = runTask,
      retryPredicate = isRetryable,
      retryDelayMs = (attempts) => 2000 * attempts,
    } = {},
  ) {
    this.db = db;
    this.taskRunner = taskRunner;
    this.retryPredicate = retryPredicate;
    this.retryDelayMs = retryDelayMs;
    this.running = 0;
    this.stopped = false;
    /** taskId -> AbortController */
    this.signals = new Map();
    /** taskId -> retry timer */
    this.retryTimers = new Map();
  }

  /** 启动：恢复中断任务、清理残留 .part、开始调度 */
  start() {
    const ts = new Date().toISOString();
    const info = this.db
      .prepare(`UPDATE tasks SET status = 'pending', updated_at = ? WHERE status IN ('active','downloading')`)
      .run(ts);
    if (info.changes > 0) console.log(`[queue] 恢复 ${info.changes} 个中断任务`);
    this.cleanupPartFiles().catch((e) => console.warn(`[queue] .part 清理失败: ${e.message}`));
    this.pump();
  }

  /** 清理上次异常退出残留的 .part 临时文件（下载未完成的残片） */
  async cleanupPartFiles() {
    const { downloadDir } = getSettings(this.db);
    let removed = 0;
    const walk = async (dir) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.name.endsWith('.part')) {
          await rm(full, { force: true });
          removed++;
        }
      }
    };
    await walk(downloadDir);
    if (removed > 0) console.log(`[queue] 清理 ${removed} 个残留 .part 文件`);
  }

  /** 新任务入队后触发调度 */
  enqueue() {
    this.pump();
  }

  /** 尝试拉起待处理任务直到达到并发上限 */
  pump() {
    if (this.stopped) return;
    const { concurrency } = getSettings(this.db);
    while (this.running < concurrency) {
      // 退避中的任务仍保持 pending 状态，但不能在定时器到期前被重新领取。
      const task = dbOps.claimNextPending(this.db, [...this.retryTimers.keys()]);
      if (!task) break;
      this.running++;
      this.worker(task).catch(() => {
        this.running--;
        this.pump();
      });
    }
  }

  async worker(task) {
    const controller = new AbortController();
    this.signals.set(task.id, controller);
    dbOps.updateTask(this.db, task.id, { status: 'active' });
    try {
      const result = await this.taskRunner(task, {
        db: this.db,
        signal: controller.signal,
        onProgress: (received, total) => {
          dbOps.updateTask(this.db, task.id, {
            status: 'downloading',
            received,
            total,
            progress: total > 0 ? Math.min(0.99, received / total) : null,
          });
        },
      });
      dbOps.updateTask(this.db, task.id, {
        status: 'success',
        progress: 1,
        received: result.received,
        total: result.total,
        file_path: result.filePath,
        quality: result.quality.code,
        quality_label: result.quality.label,
        ext: result.quality.ext,
        error: null,
      });
      dbOps.insertFile(this.db, {
        mid: task.mid,
        quality: result.quality.code,
        filePath: result.filePath,
        size: result.received,
        title: task.title,
        artist: task.artist,
        album: task.album,
      });
      console.log(`[queue] 完成: ${task.title} - ${result.quality.label} -> ${result.filePath}`);
    } catch (e) {
      const attempts = (task.attempts ?? 0) + 1;
      const { maxRetries } = getSettings(this.db);
      if (e?.code === 'ABORTED') {
        dbOps.updateTask(this.db, task.id, { status: 'canceled', attempts, error: '已取消' });
      } else if (attempts < maxRetries && this.retryPredicate(e)) {
        dbOps.updateTask(this.db, task.id, { status: 'pending', attempts, error: e.message });
        const delay = this.retryDelayMs(attempts);
        const timer = setTimeout(() => {
          this.retryTimers.delete(task.id);
          this.pump();
        }, delay);
        this.retryTimers.set(task.id, timer);
        console.warn(`[queue] 重试 ${attempts}/${maxRetries} (${delay}ms 后): ${task.title} - ${e.message}`);
      } else {
        dbOps.updateTask(this.db, task.id, { status: 'failed', attempts, error: e.message });
        console.warn(`[queue] 失败: ${task.title} - ${e.message}`);
      }
    } finally {
      this.signals.delete(task.id);
      this.running--;
      this.pump();
    }
  }

  cancel(taskId) {
    const task = dbOps.getTask(this.db, taskId);
    if (!task) return null;
    const controller = this.signals.get(taskId);
    if (controller) controller.abort();
    if (ACTIVE_STATUSES.includes(task.status) || task.status === 'pending') {
      return dbOps.updateTask(this.db, taskId, { status: 'canceled', error: '已取消' });
    }
    return task;
  }

  retry(taskId) {
    const task = dbOps.getTask(this.db, taskId);
    if (!task) return null;
    if (!['failed', 'canceled'].includes(task.status)) return task;
    dbOps.updateTask(this.db, taskId, {
      status: 'pending',
      attempts: 0,
      error: null,
      progress: 0,
      received: 0,
      total: 0,
    });
    this.pump();
    return dbOps.getTask(this.db, taskId);
  }

  /** 清空已结束任务（成功/失败/取消）。带重试定时器的失败任务先取消定时器，避免删库后定时器把任务复活。 */
  clearFinished() {
    const rows = this.db
      .prepare(`SELECT id, status FROM tasks WHERE status IN ('success', 'failed', 'canceled')`)
      .all();
    for (const row of rows) {
      const timer = this.retryTimers.get(row.id);
      if (timer) {
        clearTimeout(timer);
        this.retryTimers.delete(row.id);
      }
    }
    const cleared = dbOps.clearFinishedTasks(this.db);
    console.log(`[queue] 清空已结束任务 ${cleared} 条`);
    return cleared;
  }

  stop() {
    this.stopped = true;
    for (const controller of this.signals.values()) controller.abort();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }
}
