/**
 * 认证：QQ 扫码登录流程 + 凭证加密持久化 + Client 注入。
 */

import path from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { config } from './config.js';
import { getClient } from './qq.js';
import { Credential } from '../vendor/QQMusicapi/src/models/credential.js';
import { QrLoginEvent } from '../vendor/QQMusicapi/src/modules/login.js';
import { getOrCreateKey, encryptJson, decryptJson, randomId } from './util/crypto.js';

const CRED_PATH = () => path.join(config.dataDir, 'credentials.enc');
const KEY_PATH = () => path.join(config.dataDir, 'secret.key');

/** qrId -> { qr, createdAt } */
const pendingQr = new Map();
const QR_TTL_MS = 3 * 60 * 1000;

let key = null;
let credential = null; // Credential | null

/** 最近一次登录态探测结果（避免每次 status 都打网络） */
let lastProbe = { at: 0, expired: false };

export async function initAuth() {
  key = await getOrCreateKey(KEY_PATH());
  try {
    const b64 = await readFile(CRED_PATH(), 'utf8');
    const obj = decryptJson(b64.trim(), key);
    if (obj) {
      credential = Credential.fromDict(obj);
      applyToClient();
      console.log(`[auth] 已加载本地凭证 (musicid=${credential.musicid})`);
    }
  } catch {
    /* 无凭证文件 */
  }
  // 清理过期二维码会话
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingQr) {
      if (now - entry.createdAt > QR_TTL_MS) pendingQr.delete(id);
    }
  }, 30_000);
  timer.unref();
}

function applyToClient() {
  const client = getClient();
  client.credential = credential ?? new Credential();
}

async function persist() {
  if (!credential) {
    await rm(CRED_PATH(), { force: true });
    return;
  }
  await writeFile(CRED_PATH(), encryptJson(credential.toJSON(), key), { mode: 0o600 });
}

export function authStatus() {
  if (!credential || !credential.isLoggedIn()) {
    return { loggedIn: false, musicid: null, expired: false, keyExpiresAt: null };
  }
  const keyExpiresAt =
    credential.musickeyCreateTime && credential.keyExpiresIn
      ? new Date((credential.musickeyCreateTime + credential.keyExpiresIn) * 1000).toISOString()
      : null;
  return {
    loggedIn: true,
    musicid: credential.musicid,
    expired: Boolean(credential.isExpired()) || lastProbe.expired,
    keyExpiresAt,
    loginType: credential.loginType,
  };
}

/** 发起扫码登录 */
export async function startQrLogin() {
  const client = getClient();
  const qr = await client.login.getQrcode('qq');
  const qrId = randomId();
  pendingQr.set(qrId, { qr, createdAt: Date.now() });
  return {
    qrId,
    image: `data:${qr.mime};base64,${Buffer.from(qr.data).toString('base64')}`,
    expiresIn: Math.floor(QR_TTL_MS / 1000),
  };
}

const EVENT_NAMES = {
  [QrLoginEvent.WAIT ?? -2]: 'WAIT',
  [QrLoginEvent.SCAN]: 'SCAN',
  [QrLoginEvent.CONF]: 'CONF',
  [QrLoginEvent.DONE]: 'DONE',
  [QrLoginEvent.REFUSE]: 'REFUSE',
  [QrLoginEvent.TIMEOUT]: 'TIMEOUT',
  [QrLoginEvent.OTHER]: 'OTHER',
};

const EVENT_MESSAGES = {
  WAIT: '等待扫描',
  SCAN: '等待扫描二维码',
  CONF: '已扫描，请在手机上确认',
  DONE: '登录成功',
  REFUSE: '已拒绝登录',
  TIMEOUT: '二维码已过期，请刷新',
  OTHER: '状态未知',
};

/** 轮询扫码状态 */
export async function pollQrLogin(qrId) {
  const entry = pendingQr.get(qrId);
  if (!entry) return { event: 'TIMEOUT', message: '二维码会话不存在或已过期' };
  const client = getClient();
  try {
    const res = await client.login.checkQrcode(entry.qr);
    if (res.event === QrLoginEvent.DONE) {
      pendingQr.delete(qrId);
      credential = res.credential instanceof Credential ? res.credential : Credential.fromDict(res.credential);
      applyToClient();
      await persist();
      lastProbe = { at: Date.now(), expired: false };
      return { event: 'DONE', message: '登录成功', loggedIn: true };
    }
    return {
      event: EVENT_NAMES[res.event] ?? 'OTHER',
      message: EVENT_MESSAGES[EVENT_NAMES[res.event]] ?? '状态未知',
    };
  } catch (e) {
    return { event: 'OTHER', message: `查询失败: ${e.message}` };
  }
}

/** 主动取消一个二维码会话 */
export function cancelQrLogin(qrId) {
  pendingQr.delete(qrId);
}

/** 登出 */
export async function logout() {
  try {
    if (credential?.isLoggedIn()) {
      await getClient().login.logout(credential);
    }
  } catch {
    /* 网络失败也继续本地登出 */
  }
  credential = null;
  applyToClient();
  await persist();
  return { ok: true };
}

/** 刷新凭证（ musickey 续期） */
export async function refreshCredential() {
  if (!credential?.isLoggedIn()) return { ok: false, message: '未登录' };
  try {
    const fresh = await getClient().login.refreshCredential(credential);
    credential = fresh instanceof Credential ? fresh : Credential.fromDict(fresh);
    applyToClient();
    await persist();
    lastProbe = { at: Date.now(), expired: false };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/** 探测登录态是否过期（5 分钟缓存） */
export async function probeExpired({ force = false } = {}) {
  if (!credential?.isLoggedIn()) return false;
  const now = Date.now();
  if (!force && now - lastProbe.at < 5 * 60 * 1000) return lastProbe.expired;
  try {
    const expired = await getClient().login.checkExpired(credential);
    lastProbe = { at: now, expired: Boolean(expired) };
    return Boolean(expired);
  } catch {
    return lastProbe.expired;
  }
}

export function getCredential() {
  return credential;
}
