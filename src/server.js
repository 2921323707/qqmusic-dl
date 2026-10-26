/**
 * qqmusic-dl 服务入口。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { config, ensureDirs } from './config.js';
import { openDatabase, migrateNamingTemplate } from './db.js';
import { initAuth, probeExpired } from './auth.js';
import { DownloadQueue } from './queue.js';
import apiRoutes from './routes/api.js';
import uiRoutes from './routes/ui.js';

export async function startServer(options = {}) {
  const host = options.host ?? config.host;
  const port = options.port ?? config.port;

  await ensureDirs();

  const db = openDatabase(config.dataDir);
  const naming = migrateNamingTemplate(db);
  if (naming.includes('/')) console.log(`[db] 命名模板已为一歌一文件夹: ${naming}`);
  await initAuth();

  const fastify = Fastify({
    logger: {
      level: process.env.QQDL_LOG_LEVEL || 'info',
      transport: undefined,
    },
    bodyLimit: 1024 * 1024,
  });

  // 容错：POST 不带 Content-Type/body 时按空 JSON 处理（方便 Agent/curl 直接调用，避免 415）
  fastify.addContentTypeParser(
    ['application/json', 'text/plain', 'application/x-www-form-urlencoded', RegExp('^$')],
    { parseAs: 'string' },
    (req, body, done) => {
      const s = String(body ?? '').trim();
      if (!s) return done(null, {});
      try {
        done(null, JSON.parse(s));
      } catch (e) {
        done(e);
      }
    },
  );

  fastify.decorate('db', db);
  const queue = new DownloadQueue(db);
  fastify.decorate('queue', queue);

  // API Token 保护（设置 QQDL_API_TOKEN 后启用）
  // 例外：/api/library/:id/audio 与 /cover —— <audio>/<img> 无法自定义 Authorization 头，
  // 且内容仅为本地已下载文件；默认服务仅监听 127.0.0.1，风险可控。
  const STREAM_PATH_RE = /^\/api\/library\/\d+\/(audio|cover)(\?|$)/;
  if (config.apiToken) {
    fastify.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/')) return;
      if (STREAM_PATH_RE.test(req.url)) return;
      const header = req.headers.authorization ?? '';
      if (header !== `Bearer ${config.apiToken}`) {
        reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: '无效或缺失的 API Token' } });
      }
    });
  }

  // 统一错误格式
  fastify.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, '未处理的服务端错误');
    }
    reply.code(status).send({
      error: {
        code: err.code ?? 'INTERNAL',
        message: status >= 500 ? '服务端内部错误' : err.message,
        ...(err.hint ? { hint: err.hint } : {}),
      },
    });
  });

  await fastify.register(uiRoutes);
  await fastify.register(apiRoutes, { prefix: '' });

  // 登录态过期探测（每小时一次，仅本地有凭证时）
  const authTimer = setInterval(
    async () => {
      try {
        const expired = await probeExpired({ force: true });
        if (expired) console.warn('[auth] 登录凭证已过期，VIP 音质将不可用，请重新扫码登录');
      } catch {
        /* ignore */
      }
    },
    60 * 60 * 1000,
  );
  authTimer.unref();

  let stopping = null;
  const stop = () => {
    if (!stopping) {
      stopping = (async () => {
        clearInterval(authTimer);
        queue.stop();
        await fastify.close();
        db.close();
      })();
    }
    return stopping;
  };

  queue.start();

  try {
    await fastify.listen({ host, port });
  } catch (err) {
    await stop();
    throw err;
  }

  console.log(`[server] qqmusic-dl 已启动: http://${host}:${port}`);
  console.log(`[server] 下载目录: ${config.downloadDir}`);
  if (config.apiToken) console.log('[server] API Token 保护已启用');

  return { host, port, fastify, db, queue, stop };
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startServer()
    .then((handle) => {
      const shutdown = async () => {
        console.log('\n[server] 正在退出...');
        try {
          await handle.stop();
        } catch (err) {
          console.error('[server] 关闭失败:', err);
        }
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('[server] 启动失败:', err);
      process.exit(1);
    });
}
