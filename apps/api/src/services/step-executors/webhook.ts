import { resolveMergeTags, type MergeContext } from '../workflow-merge-tags.js';

export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

// Circuit breaker state: per hostname
const circuitState = new Map<
  string,
  { failures: number; firstFailureAt: number; openUntil: number }
>();

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10 min
const OPEN_DURATION_MS = 5 * 60 * 1000; // 5 min

export async function executeWebhook(
  contactId: string,
  config: WebhookConfig,
  mergeContext: MergeContext,
): Promise<{ statusCode: number; durationMs: number }> {
  const resolvedUrl = resolveMergeTags(config.url, mergeContext);
  const hostname = new URL(resolvedUrl).hostname;

  // Check circuit breaker
  const state = circuitState.get(hostname);
  if (state && state.openUntil > Date.now()) {
    throw new Error(`Circuit breaker open for ${hostname} — will retry after cooldown`);
  }

  // Reset stale circuit state
  if (state && state.firstFailureAt + FAILURE_WINDOW_MS < Date.now()) {
    circuitState.delete(hostname);
  }

  // Resolve merge tags in body values
  const body = config.body
    ? JSON.parse(resolveMergeTags(JSON.stringify(config.body), mergeContext))
    : { contactId };

  const start = Date.now();
  try {
    const response = await fetch(resolvedUrl, {
      method: config.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      recordFailure(hostname);
      throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
    }

    // Success — reset circuit state
    circuitState.delete(hostname);
    return { statusCode: response.status, durationMs };
  } catch (err) {
    recordFailure(hostname);
    throw err;
  }
}

function recordFailure(hostname: string): void {
  const now = Date.now();
  const state = circuitState.get(hostname);

  if (!state || state.firstFailureAt + FAILURE_WINDOW_MS < now) {
    circuitState.set(hostname, { failures: 1, firstFailureAt: now, openUntil: 0 });
    return;
  }

  state.failures += 1;
  if (state.failures >= MAX_FAILURES) {
    state.openUntil = now + OPEN_DURATION_MS;
  }
}
