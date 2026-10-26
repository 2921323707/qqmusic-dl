import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import apiRoutes from '../src/routes/api.js';
import { createTestDb } from './helpers.js';

async function createTestApp(t) {
  const { db } = await createTestDb(t);
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('queue', {
    enqueue() {},
    cancel: () => null,
    retry: () => null,
    clearFinished: () => 0,
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error.statusCode ?? 500).send({
      error: { code: error.code ?? 'INTERNAL', message: error.message },
    });
  });
  await app.register(apiRoutes);
  await app.ready();
  t.after(() => app.close());
  return app;
}

test('健康检查和配置接口返回稳定契约', async (t) => {
  const app = await createTestApp(t);

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const config = await app.inject({ method: 'GET', url: '/api/config' });
  assert.equal(config.statusCode, 200);
  assert.equal(typeof config.json().downloadDir, 'string');
  assert.ok(Array.isArray(config.json().qualities));
});

test('关键参数错误和缺失资源返回统一错误码', async (t) => {
  const app = await createTestApp(t);

  const search = await app.inject({ method: 'GET', url: '/api/search' });
  assert.equal(search.statusCode, 400);
  assert.equal(search.json().error.code, 'BAD_REQUEST');

  const download = await app.inject({
    method: 'POST',
    url: '/api/downloads',
    payload: { mid: '' },
  });
  assert.equal(download.statusCode, 400);
  assert.equal(download.json().error.code, 'BAD_REQUEST');

  const task = await app.inject({ method: 'GET', url: '/api/tasks/missing' });
  assert.equal(task.statusCode, 404);
  assert.equal(task.json().error.code, 'TASK_NOT_FOUND');
});
