import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import { env } from '../env.js';

// Inline the Google OAuth2 endpoint configuration.
// Equivalent to oauth2.GOOGLE_CONFIGURATION but avoids accessing static
// properties on the default-import function type (TS NodeNext resolution
// types the default export as a bare function, not the plugin interface).
const GOOGLE_CONFIGURATION = {
  authorizeHost: 'https://accounts.google.com',
  authorizePath: '/o/oauth2/v2/auth',
  tokenHost: 'https://www.googleapis.com',
  tokenPath: '/oauth2/v4/token',
} as const;

export default fp(async (app) => {
  await app.register(oauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'profile', 'email'],
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
      auth: GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/auth/google',
    callbackUri: `${env.API_URL}/auth/google/callback`,
  });
});
