/**
 * 文件命名：模板渲染 + 非法字符清洗 + 路径穿越防护。
 */

import path from 'node:path';

// Windows 文件名不允许控制字符。
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** 清洗单个路径片段：去非法字符、去首尾点空格、截断长度 */
export function sanitizeSegment(seg, maxLen = 120) {
  let s = String(seg ?? '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Windows 保留设备名
  if (RESERVED.test(s)) s = `_${s}`;
  s = s.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!s) s = '未知';
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

/**
 * 渲染命名模板。
 * 支持占位符 {artist} {title} {album} {quality} {year}，以及 `/` 子目录。
 * 结果保证位于 baseDir 之内（防路径穿越）。
 */
export function renderTemplate(template, vars, baseDir) {
  const rendered = String(template || '{artist} - {title} [{quality}]').replace(
    /\{(\w+)\}/g,
    (_, key) => (vars[key] != null ? String(vars[key]) : ''),
  );
  const segments = rendered
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeSegment(s))
    .filter(Boolean);
  if (segments.length === 0) segments.push(sanitizeSegment('unknown'));
  const rel = path.join(...segments);
  const abs = path.resolve(baseDir, rel);
  // 路径穿越防护
  if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) {
    return path.join(baseDir, sanitizeSegment(path.basename(rel)));
  }
  return abs;
}
