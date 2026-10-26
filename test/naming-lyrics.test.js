import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { formatLrcTime, qrcToLrc } from '../src/util/lyrics.js';
import { renderTemplate, sanitizeSegment } from '../src/util/naming.js';

test('文件名清洗覆盖非法字符、保留名和空值', () => {
  assert.equal(sanitizeSegment('  a/b:c*?  '), 'a b c');
  assert.equal(sanitizeSegment('CON'), '_CON');
  assert.equal(sanitizeSegment('...'), '未知');
  assert.equal(sanitizeSegment(null), '未知');
  assert.equal(sanitizeSegment('x'.repeat(130)).length, 120);
});

test('命名模板不会逃出下载目录', () => {
  const base = path.resolve('C:/downloads');
  const rendered = renderTemplate('../../{artist}/{title}', { artist: '歌手', title: '歌曲' }, base);
  assert.equal(rendered, path.join(base, '歌手', '歌曲'));
});

test('QRC 和 LRC 时间格式转换稳定', () => {
  assert.equal(formatLrcTime(61_234), '01:01.23');
  const qrc = '<QrcInfos LyricContent="[1000,500]你(1000,200)好(1200,300)" />';
  assert.equal(qrcToLrc(qrc), '[00:01.00]你好');
  assert.equal(qrcToLrc('[00:02.00]原文'), '[00:02.00]原文');
});
