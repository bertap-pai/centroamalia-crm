import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import { env } from '../env.js';

export default fp(async (app) => {
  await app.register(oauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'profile', 'email'],
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
      auth: oauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/auth/google',
    callbackUri: `${env.API_URL}/auth/google/callback`,
  });
});
