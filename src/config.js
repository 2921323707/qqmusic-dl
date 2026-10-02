/**
 * 全局配置：环境变量 + 默认值。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（qqmusic-dl/） */
export const ROOT = path.resolve(__dirname, '..');

function envPath(name, fallback) {
  const v = process.env[name];
  return v ? path.resolve(v) : fallback;
}

export const config = {
  root: ROOT,
  vendorDir: path.join(ROOT, 'vendor', 'QQMusicapi'),
  dataDir: envPath('QQDL_DATA_DIR', path.join(ROOT, 'data')),
  downloadDir: envPath('QQDL_DOWNLOAD_DIR', path.join(ROOT, 'downloads')),
  publicDir: path.join(ROOT, 'public'),

  host: process.env.QQDL_HOST || '127.0.0.1',
  port: Number(process.env.QQDL_PORT || 7800),

  /** 设置后 /api/* 需要 Authorization: Bearer <token> */
  apiToken: process.env.QQDL_API_TOKEN || '',

  concurrency: Number(process.env.QQDL_CONCURRENCY || 2),
  defaultQuality: process.env.QQDL_DEFAULT_QUALITY || 'F000',
  // 默认一歌一文件夹：歌曲文件与 .lrc 同在以其命名的子目录中
  namingTemplate: process.env.QQDL_NAMING || '{artist} - {title} [{quality}]/{artist} - {title} [{quality}]',
  fallback: process.env.QQDL_FALLBACK !== '0',

  maxRetries: Number(process.env.QQDL_MAX_RETRIES || 3),
  /** 单任务 HTTP 超时（毫秒） */
  requestTimeoutMs: Number(process.env.QQDL_TIMEOUT_MS || 120000),
};

/** 运行时确保必要目录存在 */
export async function ensureDirs() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.downloadDir, { recursive: true });
}
