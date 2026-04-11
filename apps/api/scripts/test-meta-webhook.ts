/**
 * Test script for the Meta Lead Ads webhook endpoint.
 *
 * Constructs a fake Meta webhook payload, computes the correct HMAC-SHA256
 * signature, and POSTs to the local /api/webhooks/meta endpoint.
 * Then queries the DB for the resulting leadSubmissions record.
 *
 * Usage:
 *   npx tsx apps/api/scripts/test-meta-webhook.ts [--api-url http://localhost:3000]
 *
 * Required env vars (loaded from .env):
 *   META_APP_SECRET          — used to compute the HMAC signature
 *   DATABASE_URL             — used to query leadSubmissions after the POST
 *   META_PAGE_ACCESS_TOKEN   — the server needs this to fetch lead data from Meta
 *   META_DEFAULT_PIPELINE_ID — the server needs this for deal creation
 *   META_DEFAULT_STAGE_ID    — the server needs this for deal creation
 */

import crypto from 'node:crypto';
import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.argv.includes('--api-url')
  ? process.argv[process.argv.indexOf('--api-url') + 1]!
  : process.env['API_URL'] ?? 'http://localhost:3000';

const META_APP_SECRET = process.env['META_APP_SECRET'] ?? '';
const DATABASE_URL = process.env['DATABASE_URL'] ?? '';

if (!META_APP_SECRET) {
  console.error('ERROR: META_APP_SECRET env var is required to compute the webhook signature.');
  console.error('Set it in your .env file or export it before running this script.');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var is required to verify the lead submission record.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build fake Meta Lead Ads payload
// ---------------------------------------------------------------------------

// Use a recognizable fake leadgen_id so we can trace it in logs
const FAKE_LEADGEN_ID = `test_lead_${Date.now()}`;

const payload = {
  object: 'page',
  entry: [
    {
      id: 'test_page_id',
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          value: {
            leadgen_id: FAKE_LEADGEN_ID,
            page_id: 'test_page_id',
            form_id: 'test_form_id',
            created_time: Math.floor(Date.now() / 1000),
          },
          field: 'leadgen',
        },
      ],
    },
  ],
};

const bodyStr = JSON.stringify(payload);

// ---------------------------------------------------------------------------
// Compute HMAC-SHA256 signature
// ---------------------------------------------------------------------------

const signature =
  'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(bodyStr).digest('hex');

// ---------------------------------------------------------------------------
// POST to webhook endpoint
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Meta Webhook Test ===');
console.log(`API URL:      ${API_URL}`);
console.log(`Leadgen ID:   ${FAKE_LEADGEN_ID}`);
console.log(`Signature:    ${signature.slice(0, 30)}...`);
console.log('');

console.log('1. Sending POST /api/webhooks/meta ...');

const res = await fetch(`${API_URL}/api/webhooks/meta`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': signature,
  },
  body: bodyStr,
});

console.log(`   Response: ${res.status} ${res.statusText}`);
const resBody = await res.text();
console.log(`   Body:     ${resBody}`);

if (res.status !== 200) {
  console.error('\nERROR: Expected 200 OK from webhook endpoint.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Wait briefly for async processing, then check the DB
// ---------------------------------------------------------------------------

console.log('\n2. Waiting 3s for async lead processing ...');
await new Promise((r) => setTimeout(r, 3000));

console.log('3. Querying leadSubmissions table ...\n');

const sql = postgres(DATABASE_URL);

try {
  const rows = await sql`
    SELECT id, source, status, error_message, received_at, mapped_phone_e164, mapped_fields
    FROM lead_submissions
    WHERE source = 'meta'
    ORDER BY received_at DESC
    LIMIT 5
  `;

  if (rows.length === 0) {
    console.log('   No leadSubmissions rows with source=meta found.');
    console.log('');
    console.log('   Possible causes:');
    console.log('   - META_APP_SECRET mismatch (HMAC check fails silently)');
    console.log('   - Webhook endpoint is not registered / route not loaded');
    console.log('   - Server is not running at ' + API_URL);
  } else {
    console.log(`   Found ${rows.length} recent meta lead submissions:\n`);
    for (const row of rows) {
      const status = row.status === 'processed' ? 'processed' : `${row.status}`;
      console.log(`   [${row.id}]`);
      console.log(`     Status:    ${status}`);
      console.log(`     Received:  ${row.received_at}`);
      console.log(`     Phone:     ${row.mapped_phone_e164 ?? '(none)'}`);
      console.log(`     Error:     ${row.error_message ?? '(none)'}`);
      console.log('');
    }
  }

  // Also check if the most recent row might be from our test
  const latest = rows[0];
  if (latest) {
    if (latest.status === 'failed') {
      console.log('   Latest submission FAILED. Check error_message above.');
      console.log('   Common causes:');
      console.log('   - META_PAGE_ACCESS_TOKEN expired or not set (Graph API call fails)');
      console.log('   - META_DEFAULT_STAGE_ID points to a nonexistent stage');
    } else if (latest.status === 'needs_review') {
      console.log('   Latest submission needs review — no phone or email was found in lead data.');
    } else if (latest.status === 'processed') {
      console.log('   Latest submission processed successfully!');
    }
  }
} finally {
  await sql.end();
}

console.log('\n=== Done ===\n');
