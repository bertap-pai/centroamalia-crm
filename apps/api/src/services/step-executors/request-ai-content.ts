import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { workflowRuns } from '@crm/db';
import type { WorkflowRun } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { resolveMergeTags, type MergeContext } from '../workflow-merge-tags.js';

type Db = FastifyInstance['db'];

export interface RequestAiContentConfig {
  prompt: string;           // template with merge tags, e.g. "Write a welcome email for {{contact.first_name}}"
  outputVariable: string;   // key name stored in runVariables, referenced via {{var.outputVariable}}
  model?: string;           // defaults to claude-haiku-4-5-20251001
  maxTokens?: number;       // defaults to 1024
}

export async function executeRequestAiContent(
  db: Db,
  run: WorkflowRun,
  config: RequestAiContentConfig,
  mergeContext: MergeContext,  // mutated in place — subsequent steps see the new var
): Promise<void> {
  if (!config.prompt) throw new Error('request_ai_content: prompt is required');
  if (!config.outputVariable) throw new Error('request_ai_content: outputVariable is required');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var is not set');

  const client = new Anthropic({ apiKey });
  const resolvedPrompt = resolveMergeTags(config.prompt, mergeContext);

  const response = await client.messages.create({
    model: config.model ?? 'claude-haiku-4-5-20251001',
    max_tokens: config.maxTokens ?? 1024,
    messages: [{ role: 'user', content: resolvedPrompt }],
  });

  const resultText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  // Merge into existing runVariables and persist to DB
  const currentVars = (run.runVariables as Record<string, string> | null) ?? {};
  const newVars = { ...currentVars, [config.outputVariable]: resultText };
  await db
    .update(workflowRuns)
    .set({ runVariables: newVars })
    .where(eq(workflowRuns.id, run.id));

  // Update in-memory context so subsequent steps in this run can use the value immediately
  mergeContext.var = newVars;
}
