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
  // Meta Lead Ads webhook
  META_VERIFY_TOKEN: process.env['META_VERIFY_TOKEN'] ?? '',
  META_APP_SECRET: process.env['META_APP_SECRET'] ?? '',
  META_PAGE_ACCESS_TOKEN: process.env['META_PAGE_ACCESS_TOKEN'] ?? '',
  META_DEFAULT_PIPELINE_ID: process.env['META_DEFAULT_PIPELINE_ID'] ?? '',
  META_DEFAULT_STAGE_ID: process.env['META_DEFAULT_STAGE_ID'] ?? '',
  // TikTok Lead Ads webhook
  TIKTOK_WEBHOOK_SECRET: process.env['TIKTOK_WEBHOOK_SECRET'] ?? '',
  TIKTOK_ACCESS_TOKEN: process.env['TIKTOK_ACCESS_TOKEN'] ?? '',
  TIKTOK_DEFAULT_PIPELINE_ID: process.env['TIKTOK_DEFAULT_PIPELINE_ID'] ?? '',
  TIKTOK_DEFAULT_STAGE_ID: process.env['TIKTOK_DEFAULT_STAGE_ID'] ?? '',
  // Downtime alert: fire notification if server was offline longer than this
  DOWNTIME_ALERT_THRESHOLD_MINUTES: parseInt(process.env['DOWNTIME_ALERT_THRESHOLD_MINUTES'] ?? '10', 10),
} as const;
