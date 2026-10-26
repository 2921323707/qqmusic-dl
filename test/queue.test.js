import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import * as dbOps from '../src/db.js';
import { DownloadQueue } from '../src/queue.js';
import { setSetting } from '../src/db.js';
import { TaskError } from '../src/task.js';
import { createTask, createTestDb, waitFor } from './helpers.js';

function resultFor(task, dir) {
  return {
    filePath: path.join(dir, `${task.id}.mp3`),
    quality: { code: task.quality, label: 'MP3 320', ext: '.mp3' },
    received: 3,
    total: 3,
  };
}

test('队列遵守并发上限并完成全部任务', async (t) => {
  const { db, dir } = await createTestDb(t);
  setSetting(db, 'concurrency', 1);
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queue = new DownloadQueue(db, {
    taskRunner: async (task) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      return resultFor(task, dir);
    },
  });
  t.after(() => queue.stop());

  dbOps.createTask(db, createTask('task-1'));
  dbOps.createTask(db, createTask('task-2'));
  queue.enqueue();

  await waitFor(() => dbOps.listTasks(db).some((task) => task.status === 'active'));
  assert.equal(maxActive, 1);
  assert.equal(dbOps.listTasks(db, ['pending']).length, 1);

  release();
  await waitFor(() => dbOps.listTasks(db, ['success']).length === 2);
  assert.equal(maxActive, 1);
});

test('失败任务必须等待退避定时器到期后才会重试', async (t) => {
  const { db, dir } = await createTestDb(t);
  setSetting(db, 'concurrency', 1);
  setSetting(db, 'max_retries', 2);
  let calls = 0;
  const queue = new DownloadQueue(db, {
    retryDelayMs: () => 40,
    taskRunner: async (task) => {
      calls++;
      if (calls === 1) throw new Error('临时网络错误');
      return resultFor(task, dir);
    },
  });
  t.after(() => queue.stop());

  dbOps.createTask(db, createTask('retry-task'));
  queue.enqueue();

  await waitFor(() => calls === 1 && dbOps.getTask(db, 'retry-task').status === 'pending');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);

  await waitFor(() => dbOps.getTask(db, 'retry-task').status === 'success');
  assert.equal(calls, 2);
});

test('取消运行中的任务会中止执行并落库为 canceled', async (t) => {
  const { db } = await createTestDb(t);
  setSetting(db, 'concurrency', 1);
  const queue = new DownloadQueue(db, {
    taskRunner: async (_task, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new TaskError('ABORTED', '已取消')), { once: true });
      }),
  });
  t.after(() => queue.stop());

  dbOps.createTask(db, createTask('cancel-task'));
  queue.enqueue();
  await waitFor(() => dbOps.getTask(db, 'cancel-task').status === 'active');

  queue.cancel('cancel-task');
  await waitFor(() => dbOps.getTask(db, 'cancel-task').status === 'canceled');
});
