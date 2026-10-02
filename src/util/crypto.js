/**
 * AES-256-GCM 加解密工具：用于登录凭证的落盘加密。
 * 密钥为 32 字节随机值，存于 data/secret.key（权限 0600）。
 */

import crypto from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ALGO = 'aes-256-gcm';

/** 读取或创建密钥文件 */
export async function getOrCreateKey(keyPath) {
  try {
    const buf = await readFile(keyPath);
    if (buf.length === 32) return buf;
  } catch {
    /* 不存在则创建 */
  }
  const key = crypto.randomBytes(32);
  await writeFile(keyPath, key, { mode: 0o600 });
  try {
    await chmod(keyPath, 0o600);
  } catch {
    /* Windows 上 chmod 语义有限，忽略 */
  }
  return key;
}

/**
 * 加密 JSON 值 -> base64 字符串（iv(12) + tag(16) + ciphertext）
 */
export function encryptJson(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * 解密 base64 字符串 -> JSON 值。数据损坏/密钥不匹配时返回 null。
 */
export function decryptJson(b64, key) {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

/** 生成随机 id */
export function randomId() {
  return crypto.randomUUID();
}

export const secretKeyPath = (dataDir) => path.join(dataDir, 'secret.key');
