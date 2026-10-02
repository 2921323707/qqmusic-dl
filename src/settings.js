/**
 * 运行时设置：config 默认值 + SQLite settings 表覆盖。
 */

import { config } from './config.js';
import * as dbOps from './db.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function getSettings(db) {
  const s = dbOps.getAllSettings(db);
  return {
    namingTemplate: s.naming_template || config.namingTemplate,
    downloadDir: s.download_dir || config.downloadDir,
    concurrency: clamp(Number(s.concurrency) || config.concurrency, 1, 8),
    defaultQuality: s.default_quality || config.defaultQuality,
    fallback: s.fallback == null ? config.fallback : s.fallback !== '0',
    maxRetries: clamp(Number(s.max_retries) || config.maxRetries, 0, 10),
  };
}

const ALLOWED_CONFIG_KEYS = new Set([
  'naming_template',
  'download_dir',
  'concurrency',
  'default_quality',
  'fallback',
  'max_retries',
]);

/** 前端/Agent 常用 camelCase 别名 -> 内部 snake_case 键 */
const KEY_ALIAS = {
  namingTemplate: 'naming_template',
  downloadDir: 'download_dir',
  defaultQuality: 'default_quality',
  maxRetries: 'max_retries',
};

/** 校验并持久化配置补丁，返回更新后的完整设置 */
export function updateSettings(db, rawPatch, { isAllowedQuality }) {
  const patch = {};
  for (const [k, v] of Object.entries(rawPatch ?? {})) {
    patch[KEY_ALIAS[k] ?? k] = v;
  }
  const unknown = Object.keys(patch).filter((k) => !ALLOWED_CONFIG_KEYS.has(k));
  if (unknown.length > 0) {
    const e = new Error(`未知配置项: ${unknown.join(', ')}`);
    e.statusCode = 400;
    e.code = 'CONFIG_INVALID';
    throw e;
  }
  const errors = [];
  const clean = {};

  if (patch.naming_template !== undefined) {
    const t = String(patch.naming_template);
    if (!t.trim() || t.length > 500) errors.push('naming_template 无效');
    else clean.naming_template = t;
  }
  if (patch.download_dir !== undefined) {
    const d = String(patch.download_dir);
    if (!d.trim()) errors.push('download_dir 不能为空');
    else clean.download_dir = d;
  }
  if (patch.concurrency !== undefined) {
    const n = Number(patch.concurrency);
    if (!Number.isInteger(n) || n < 1 || n > 8) errors.push('concurrency 需为 1-8 的整数');
    else clean.concurrency = n;
  }
  if (patch.default_quality !== undefined) {
    const q = String(patch.default_quality);
    if (!isAllowedQuality(q)) errors.push(`default_quality 无效: ${q}`);
    else clean.default_quality = q;
  }
  if (patch.fallback !== undefined) {
    clean.fallback = patch.fallback ? '1' : '0';
  }
  if (patch.max_retries !== undefined) {
    const n = Number(patch.max_retries);
    if (!Number.isInteger(n) || n < 0 || n > 10) errors.push('max_retries 需为 0-10 的整数');
    else clean.max_retries = n;
  }

  if (errors.length > 0) {
    const e = new Error(`配置校验失败: ${errors.join('; ')}`);
    e.statusCode = 400;
    e.code = 'CONFIG_INVALID';
    throw e;
  }
  for (const [k, v] of Object.entries(clean)) dbOps.setSetting(db, k, v);
  return getSettings(db);
}
