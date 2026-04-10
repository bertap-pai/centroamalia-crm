import crypto from 'node:crypto';
import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import type { FastifyRequest } from 'fastify';
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

// Stateless OAuth state: nonce.HMAC(nonce, secret)
// No session cookie needed — the HMAC proves we generated this state.
function generateStateFunction(this: unknown, _request: FastifyRequest): string {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', env.SESSION_SECRET)
    .update(nonce)
    .digest('base64url');
  return `${nonce}.${hmac}`;
}

function checkStateFunction(this: unknown, request: FastifyRequest): boolean {
  const stateParam =
    (request.query as Record<string, string>).state ?? '';
  const dotIdx = stateParam.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const nonce = stateParam.slice(0, dotIdx);
  const receivedHmac = stateParam.slice(dotIdx + 1);
  const expectedHmac = crypto
    .createHmac('sha256', env.SESSION_SECRET)
    .update(nonce)
    .digest('base64url');
  return (
    receivedHmac.length === expectedHmac.length &&
    crypto.timingSafeEqual(
      Buffer.from(receivedHmac),
      Buffer.from(expectedHmac),
    )
  );
}

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
    generateStateFunction,
    checkStateFunction,
  });
});
