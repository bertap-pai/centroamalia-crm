import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { contacts } from '@crm/db';
import type { WorkflowRun } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { resolveMergeTags, type MergeContext } from '../workflow-merge-tags.js';

type Db = FastifyInstance['db'];

export interface AiClassifyConfig {
  categories: string[];      // e.g. ['hot_lead', 'cold_lead', 'nurture']
  prompt: string;            // template describing what to classify, e.g. "Classify this contact based on their email activity."
  outputProperty: string;    // contact property key to write the result to, e.g. 'lead_score_label'
  model?: string;            // defaults to claude-haiku-4-5-20251001
}

/**
 * Exported for unit testing. Parses Claude's response text into one of the
 * known categories. Tries exact match first, then partial match.
 */
export function extractClassification(responseText: string, categories: string[]): string | null {
  const cleaned = responseText.trim();
  const exactMatch = categories.find(
    (c) => c.toLowerCase() === cleaned.toLowerCase(),
  );
  if (exactMatch) return exactMatch;
  const partialMatch = categories.find((c) =>
    cleaned.toLowerCase().includes(c.toLowerCase()),
  );
  return partialMatch ?? null;
}

export async function executeAiClassify(
  db: Db,
  run: WorkflowRun,
  config: AiClassifyConfig,
  mergeContext: MergeContext,
): Promise<void> {
  if (!config.categories || config.categories.length === 0) {
    throw new Error('ai_classify: at least one category is required');
  }
  if (!config.outputProperty) throw new Error('ai_classify: outputProperty is required');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var is not set');

  const client = new Anthropic({ apiKey });
  const resolvedPrompt = resolveMergeTags(config.prompt, mergeContext);

  const systemPrompt =
    `You are a contact classification assistant. Respond with ONLY one of these exact values (no punctuation, no explanation): ${config.categories.join(', ')}`;

  const response = await client.messages.create({
    model: config.model ?? 'claude-haiku-4-5-20251001',
    max_tokens: 50,
    system: systemPrompt,
    messages: [{ role: 'user', content: resolvedPrompt }],
  });

  const responseText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  const classification = extractClassification(responseText, config.categories);
  if (!classification) {
    throw new Error(
      `ai_classify: Claude returned "${responseText.slice(0, 100)}" — none of the categories matched: ${config.categories.join(', ')}`,
    );
  }

  // Write to contact property (reuse existing update pattern)
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.id, run.contactId))
    .limit(1);

  if (!contact) throw new Error(`ai_classify: contact ${run.contactId} not found`);

  const { executeUpdateContactProperty } = await import('./update-contact-property.js');
  await executeUpdateContactProperty(
    db,
    run.contactId,
    { property: config.outputProperty, value: classification },
    mergeContext,
  );
}
