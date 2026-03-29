function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  SESSION_SECRET: process.env['SESSION_SECRET'] ?? 'dev-secret-change-me-at-least-32-chars!!',
  ALLOWED_EMAIL_DOMAIN: process.env['ALLOWED_EMAIL_DOMAIN'] ?? 'centroamalia.com',
  ALLOWED_EMAILS: (process.env['ALLOWED_EMAILS'] ?? '').split(',').filter(Boolean),
  API_URL: process.env['API_URL'] ?? 'http://localhost:3000',
  WEB_URL: process.env['WEB_URL'] ?? 'http://localhost:5173',
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  COOKIE_SECURE: process.env['NODE_ENV'] === 'production',
} as const;
