import type { FastifyPluginAsync } from 'fastify';
import type { OAuth2Token } from '@fastify/oauth2';
import { eq, count } from 'drizzle-orm';
import { users } from '@crm/db';
import { env } from '../env.js';

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

function isEmailAllowed(email: string): boolean {
  const lower = email.toLowerCase();
  if (env.ALLOWED_EMAILS.some((e) => e.toLowerCase() === lower)) return true;
  if (env.ALLOWED_EMAIL_DOMAIN && lower.endsWith('@' + env.ALLOWED_EMAIL_DOMAIN.toLowerCase())) {
    return true;
  }
  return false;
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Google OAuth2 callback
  app.get('/auth/google/callback', async (req, reply) => {
    // Explicit OAuth2Token type avoids the Awaited<ReturnType<overload>> pitfall
    // where TS resolves to the last (void-returning) overload.
    let tokenData: OAuth2Token;
    try {
      tokenData = await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
    } catch (err) {
      req.log.warn({ err }, 'OAuth2 token exchange failed');
      return reply.redirect(`${env.WEB_URL}/login?error=oauth_failed`);
    }

    // Fetch Google profile
    let profile: GoogleUserInfo;
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.token.access_token}` },
      });
      if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
      profile = (await res.json()) as GoogleUserInfo;
    } catch (err) {
      req.log.error({ err }, 'Failed to fetch Google user info');
      return reply.redirect(`${env.WEB_URL}/login?error=profile_failed`);
    }

    // Allowlist check
    if (!isEmailAllowed(profile.email)) {
      req.log.warn({ email: profile.email }, 'OAuth login rejected — email not in allowlist');
      return reply.redirect(`${env.WEB_URL}/login?error=not_authorized`);
    }

    // First user ever gets admin role automatically
    const [{ n: userCount }] = await app.db.select({ n: count() }).from(users);
    const isFirstUser = userCount === 0;

    // Upsert user
    const [user] = await app.db
      .insert(users)
      .values({
        email: profile.email,
        name: profile.name,
        googleId: profile.id,
        role: isFirstUser ? 'admin' : 'user',
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: profile.name,
          googleId: profile.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!user) {
      req.log.error({ email: profile.email }, 'User upsert returned empty');
      return reply.redirect(`${env.WEB_URL}/login?error=server_error`);
    }

    req.session.userId = user.id;

    return reply.redirect(`${env.WEB_URL}/`);
  });

  // Current user
  app.get(
    '/api/auth/me',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const { id, email, name, role, createdAt } = req.user!;
      return reply.send({ id, email, name, role, createdAt });
    },
  );

  // Logout
  app.post('/api/auth/logout', async (req, reply) => {
    req.session.destroy((err) => {
      if (err) req.log.warn({ err }, 'session destroy error on logout');
    });
    return reply.send({ ok: true });
  });
};

export default authRoutes;
