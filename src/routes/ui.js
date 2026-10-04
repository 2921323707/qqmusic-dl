/**
 * 静态 UI 路由。
 */

import fastifyStatic from '@fastify/static';
import { config } from '../config.js';

export default async function uiRoutes(fastify) {
  await fastify.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
  });
}
