/**
 * 静态 UI 路由。
 */

import fastifyStatic from '@fastify/static';
import { config } from '../config.js';

export default async function uiRoutes(fastify) {
  // 产品动画页短地址
  fastify.get('/intro', async (req, reply) => reply.redirect('/intro.html'));
  await fastify.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
  });
}
