/**
 * 为旧媒体库补齐独立侧车封面。仅由用户手动触发，不参与下载主流程。
 */

import * as dbOps from './db.js';
import { getSongDetail } from './qq.js';
import { fetchCover, readCover, saveSidecarCover } from './metadata.js';

const defaultOperations = {
  getSongDetail,
  fetchCover,
  readCover,
  saveSidecarCover,
};

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

/**
 * @returns {Promise<{total:number, repaired:number, skipped:number, failed:number}>}
 */
export async function repairLibraryCovers(db, { concurrency = 3, operations = {} } = {}) {
  const ops = { ...defaultOperations, ...operations };
  const { files } = dbOps.listFiles(db, { limit: 1_000_000 });
  const total = files.length;
  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(files, Math.min(5, Math.max(1, Number(concurrency) || 3)), async (file) => {
    if (file.exists === false) {
      skipped++;
      return;
    }

    try {
      const existing = await ops.readCover(file.filePath);
      if (existing.buffer) {
        skipped++;
        return;
      }

      const detail = await ops.getSongDetail(file.mid);
      const cover = await ops.fetchCover(detail?.cover);
      if (!cover.buffer) throw new Error('未获取到封面');
      await ops.saveSidecarCover(file.filePath, cover.buffer, cover.mime);
      repaired++;
    } catch {
      failed++;
    }
  });

  return { total, repaired, skipped, failed };
}
