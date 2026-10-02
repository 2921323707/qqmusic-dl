/**
 * 歌词格式转换：QQ Music QRC（XML 包装 + 逐字时间戳）-> 标准 LRC。
 * 输入为 qrcDecrypt 的输出；已是标准 LRC 的内容原样通过。
 */

/** ms -> [mm:ss.xx] */
export function formatLrcTime(ms) {
  const total = Math.max(0, Math.round(ms / 10));
  const min = Math.floor(total / 6000);
  const sec = Math.floor((total % 6000) / 100);
  const cs = total % 100;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function xmlUnescape(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 将 QRC 内容转为 LRC 文本。
 * - 若是 <QrcInfos> XML：提取 LyricContent，去掉逐字时间戳，行时间戳转为 [mm:ss.xx]
 * - 若已是标准 LRC：原样返回（仅做行归一）
 */
export function qrcToLrc(input) {
  if (!input) return '';
  let content = String(input);

  // 提取 LyricContent 属性（QRC XML 形态）
  const m = content.match(/LyricContent="([\s\S]*?)"\s*\/?>/);
  if (m) content = xmlUnescape(m[1]);

  const out = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // QRC 行: [startMs,durationMs]word(startMs,durationMs)word...
    const lm = line.match(/^\[(\d+),\d+\]([\s\S]*)$/);
    if (lm) {
      const startMs = parseInt(lm[1], 10);
      const text = lm[2].replace(/\(\s*\d+\s*,\s*\d+\s*\)/g, '');
      if (text.trim()) out.push(`[${formatLrcTime(startMs)}]${text}`);
    } else {
      // [ti:] [ar:] [offset:] 等元数据行或普通 LRC 行，原样保留
      out.push(line);
    }
  }
  return out.join('\n');
}
