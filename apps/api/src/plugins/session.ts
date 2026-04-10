import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { env } from '../env.js';

export default fp(async (app) => {
  await app.register(cookie);
  await app.register(session, {
    secret: env.SESSION_SECRET,
    saveUninitialized: true,
    cookie: {
      secure: env.COOKIE_SECURE,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
    },
  });
});
