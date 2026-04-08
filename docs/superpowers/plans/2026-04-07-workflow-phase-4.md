# Workflow Automation — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase 4 of the workflow engine: three AI step types (`trigger_agent`, `request_ai_content`, `ai_classify`), a workflow analytics endpoint, and bulk contact enrollment.

**Architecture:** AI steps use the Anthropic SDK (`@anthropic-ai/sdk`) to call Claude models. `request_ai_content` stores generated text in a new `run_variables` JSONB column on `workflow_runs` and exposes it in subsequent steps via `{{var.variable_name}}` merge tags. `ai_classify` calls Claude with a constrained output prompt and writes the result directly to a contact property. `trigger_agent` calls the Paperclip API to create a task assigned to a specified agent. Analytics are aggregated from the existing `workflow_runs` and `workflow_step_logs` tables.

**Tech Stack:** Node.js / TypeScript / Fastify / Drizzle ORM / PostgreSQL / React. Anthropic SDK: `@anthropic-ai/sdk`. Tests: `node:test` + `node:assert/strict`, run with `cd apps/api && npx tsx --test src/__tests__/<file>.ts`. Typecheck: `pnpm tsc --noEmit` from repo root.

---

## File Map

**Modified — database:**
- `packages/db/src/schema/workflows.ts` — add 3 step types to enum; add `runVariables` column to `workflowRuns`
- `packages/db/migrations/0018_workflow_phase4.sql` — hand-written migration (ALTER TYPE + ALTER TABLE)

**Modified — backend services:**
- `apps/api/src/services/workflow-merge-tags.ts` — add `var` namespace to `MergeContext`; handle `{{var.key}}` in resolver
- `apps/api/src/services/workflow-executor.ts` — register 3 new step types; populate `mergeContext.var` from `run.runVariables` in `buildMergeContext`
- `apps/api/src/routes/workflows.ts` — add analytics endpoint + bulk enrollment endpoint

**Created — step executors:**
- `apps/api/src/services/step-executors/request-ai-content.ts` — calls Anthropic API, saves result to `runVariables`, mutates `mergeContext.var`
- `apps/api/src/services/step-executors/ai-classify.ts` — calls Anthropic API, parses classification, saves to contact property
- `apps/api/src/services/step-executors/trigger-agent.ts` — calls Paperclip API to create a task

**Modified — frontend:**
- `apps/web/src/components/WorkflowStepEditor.tsx` — add 3 new step types to labels, icons, defaults, summaries
- `apps/web/src/pages/WorkflowEditorPage.tsx` — add 'analytics' tab; add bulk enrollment modal + button

**Created — tests:**
- `apps/api/src/__tests__/workflow-ai-steps.test.ts` — tests for `extractClassification` helper and merge-tag var resolution

---

## Task 1: DB schema — new step types + `run_variables` column

**Files:**
- Modify: `packages/db/src/schema/workflows.ts`
- Create: `packages/db/migrations/0018_workflow_phase4.sql`

- [ ] **Step 1: Add 3 new step types to `workflowStepTypeEnum`**

In `packages/db/src/schema/workflows.ts`, find the `workflowStepTypeEnum` declaration (currently ends with `'unenroll_from_workflow'`) and add three new values:

```ts
export const workflowStepTypeEnum = pgEnum('workflow_step_type', [
  'update_contact_property',
  'create_task',
  'add_tag',
  'remove_tag',
  'send_internal_notification',
  'webhook',
  'wait',
  'branch',
  'wait_until',
  'create_deal',
  'move_deal_stage',
  'update_deal_property',
  'assign_owner',
  'enroll_in_workflow',
  'unenroll_from_workflow',
  'trigger_agent',
  'request_ai_content',
  'ai_classify',
]);
```

- [ ] **Step 2: Add `runVariables` column to `workflowRuns`**

In the same file, find the `workflowRuns` table and add `runVariables` after `lastStepExecuted`:

```ts
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    status: workflowRunStatusEnum('status').notNull().default('running'),
    lastStepExecuted: integer('last_step_executed'),
    runVariables: jsonb('run_variables'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    workflowIdx: index('workflow_runs_workflow_idx').on(t.workflowId),
    contactIdx: index('workflow_runs_contact_idx').on(t.contactId),
    statusIdx: index('workflow_runs_status_idx').on(t.status),
    startedAtIdx: index('workflow_runs_started_at_idx').on(t.startedAt),
  }),
);
```

Make sure `jsonb` is imported at the top of the file from `drizzle-orm/pg-core` (it should already be since the `workflowTriggerSchedules` table uses it).

- [ ] **Step 3: Write migration SQL**

Create `packages/db/migrations/0018_workflow_phase4.sql`:

```sql
-- Phase 4: AI step types + run variables

-- New step types (IF NOT EXISTS is Postgres 9.6+, safe to use)
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'trigger_agent';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'request_ai_content';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'ai_classify';

-- Run-scoped variable store for inter-step data passing
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_variables jsonb;
```

- [ ] **Step 4: Verify typecheck passes**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors. If `jsonb` is already imported in `workflows.ts` this will be clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/workflows.ts packages/db/migrations/0018_workflow_phase4.sql
git commit -m "feat(workflows): add Phase 4 step types and run_variables column

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 2: MergeContext `var` namespace

**Files:**
- Modify: `apps/api/src/services/workflow-merge-tags.ts`
- Modify: `apps/api/src/services/workflow-executor.ts`

- [ ] **Step 1: Add `var` to `MergeContext` interface**

In `apps/api/src/services/workflow-merge-tags.ts`, add `var` to the interface:

```ts
export interface MergeContext {
  contact?: Record<string, unknown>;
  deal?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  user?: Record<string, unknown>;
  centre?: Record<string, unknown>;
  var?: Record<string, string>;  // run-scoped variables from request_ai_content steps
}
```

- [ ] **Step 2: Handle `var` in `resolvePath`**

The existing `resolvePath` looks up `context[namespace]`. Since `var` is a valid object key in TypeScript, it already works for dot-path lookup. No change needed to `resolvePath` — the generic path already handles `{{var.my_key}}` correctly because `namespace = 'var'` and `segments.slice(1) = ['my_key']`.

Verify by tracing: `path = 'var.my_key'` → `namespace = 'var'` → `obj = context.var` → `remaining = ['my_key']` → looks up `obj['my_key']` → returns string value. ✓

- [ ] **Step 3: Populate `mergeContext.var` in `buildMergeContext`**

In `apps/api/src/services/workflow-executor.ts`, update `buildMergeContext` to add the `var` block after the workflow section:

```ts
async function buildMergeContext(db: Db, run: WorkflowRun): Promise<MergeContext> {
  const context: MergeContext = {};

  // Load contact
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, run.contactId))
    .limit(1);

  if (contact) {
    context.contact = {
      id: contact.id,
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phoneE164,
    };
  }

  // Load deal if present
  if (run.dealId) {
    const [deal] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, run.dealId))
      .limit(1);

    if (deal) {
      context.deal = {
        id: deal.id,
        pipeline_id: deal.pipelineId,
        stage_id: deal.stageId,
      };
    }
  }

  // Load workflow
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, run.workflowId))
    .limit(1);

  if (workflow) {
    context.workflow = {
      id: workflow.id,
      name: workflow.name,
    };
  }

  // Load run variables (populated by request_ai_content steps)
  if (run.runVariables && typeof run.runVariables === 'object') {
    context.var = run.runVariables as Record<string, string>;
  }

  return context;
}
```

- [ ] **Step 4: Write tests for var namespace**

Create `apps/api/src/__tests__/workflow-ai-steps.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMergeTags } from '../services/workflow-merge-tags.js';

describe('MergeContext var namespace', () => {
  it('resolves {{var.key}} when var is populated', () => {
    const ctx = {
      contact: { first_name: 'Ana' },
      var: { welcome_message: 'Hola Ana, benvinguda!' },
    };
    const result = resolveMergeTags('Message: {{var.welcome_message}}', ctx);
    assert.equal(result, 'Message: Hola Ana, benvinguda!');
  });

  it('returns empty string for missing var key', () => {
    const ctx = { var: { other_key: 'x' } };
    const result = resolveMergeTags('{{var.missing}}', ctx);
    assert.equal(result, '');
  });

  it('returns empty string when var namespace is absent', () => {
    const ctx = { contact: { first_name: 'Ana' } };
    const result = resolveMergeTags('{{var.anything}}', ctx);
    assert.equal(result, '');
  });

  it('combines var tags with contact tags in same template', () => {
    const ctx = {
      contact: { first_name: 'Ana' },
      var: { promo_code: 'WELCOME10' },
    };
    const result = resolveMergeTags('Hola {{contact.first_name}}, el teu codi és {{var.promo_code}}', ctx);
    assert.equal(result, 'Hola Ana, el teu codi és WELCOME10');
  });
});
```

- [ ] **Step 5: Run the test**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-ai-steps.test.ts
```

Expected: 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/workflow-merge-tags.ts apps/api/src/services/workflow-executor.ts apps/api/src/__tests__/workflow-ai-steps.test.ts
git commit -m "feat(workflows): add {{var.*}} merge tag namespace for run-scoped AI content

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 3: Install Anthropic SDK + `request_ai_content` executor

**Files:**
- Create: `apps/api/src/services/step-executors/request-ai-content.ts`
- Modify: `apps/api/src/services/workflow-executor.ts`

- [ ] **Step 1: Install `@anthropic-ai/sdk`**

```bash
pnpm --filter @crm/api add @anthropic-ai/sdk
```

Expected output: package added to `apps/api/package.json`.

- [ ] **Step 2: Create the executor**

Create `apps/api/src/services/step-executors/request-ai-content.ts`:

```ts
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
```

- [ ] **Step 3: Register in `executeSingleStep`**

In `apps/api/src/services/workflow-executor.ts`, add the import at the top:

```ts
import { executeRequestAiContent, type RequestAiContentConfig } from './step-executors/request-ai-content.js';
```

Then in the `switch` inside `executeSingleStep`, add before the `default` case:

```ts
    case 'request_ai_content':
      await executeRequestAiContent(
        db,
        run,
        config as unknown as RequestAiContentConfig,
        mergeContext,
      );
      break;
```

Note: `executeSingleStep` already takes `mergeContext` as a parameter and passes it to all executors. The mutation of `mergeContext.var` inside `executeRequestAiContent` will be visible to the `executeRun` loop because objects are passed by reference in JavaScript.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/step-executors/request-ai-content.ts apps/api/src/services/workflow-executor.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(workflows): add request_ai_content step executor

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 4: `ai_classify` executor

**Files:**
- Create: `apps/api/src/services/step-executors/ai-classify.ts`
- Modify: `apps/api/src/services/workflow-executor.ts`
- Modify: `apps/api/src/__tests__/workflow-ai-steps.test.ts`

- [ ] **Step 1: Write the failing test first**

Add to `apps/api/src/__tests__/workflow-ai-steps.test.ts`:

```ts
// Pure helper: extract classification from Claude response
function extractClassification(responseText: string, categories: string[]): string | null {
  const cleaned = responseText.trim();
  // Exact match first (case-insensitive)
  const exactMatch = categories.find(
    (c) => c.toLowerCase() === cleaned.toLowerCase(),
  );
  if (exactMatch) return exactMatch;
  // Fallback: first category found anywhere in the response
  const partialMatch = categories.find((c) =>
    cleaned.toLowerCase().includes(c.toLowerCase()),
  );
  return partialMatch ?? null;
}

describe('extractClassification', () => {
  it('returns exact match when response equals a category', () => {
    const result = extractClassification('hot_lead', ['hot_lead', 'cold_lead', 'nurture']);
    assert.equal(result, 'hot_lead');
  });

  it('is case-insensitive for exact match', () => {
    const result = extractClassification('Hot_Lead', ['hot_lead', 'cold_lead']);
    assert.equal(result, 'hot_lead');
  });

  it('falls back to partial match when response includes category', () => {
    const result = extractClassification('I classify this as cold_lead.', ['hot_lead', 'cold_lead']);
    assert.equal(result, 'cold_lead');
  });

  it('returns null when no category matches', () => {
    const result = extractClassification('unknown', ['hot_lead', 'cold_lead']);
    assert.equal(result, null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-ai-steps.test.ts
```

Expected: `ReferenceError: extractClassification is not defined` (or test failures since the function is defined in the test file — they should actually pass. If they pass, move on.)

- [ ] **Step 3: Create the executor (exports the helper for testability)**

Create `apps/api/src/services/step-executors/ai-classify.ts`:

```ts
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

  // Write to contact property (reuse existing upsert pattern)
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.id, run.contactId))
    .limit(1);

  if (!contact) throw new Error(`ai_classify: contact ${run.contactId} not found`);

  // Import here to avoid circular deps — same pattern as branch executor
  const { executeUpdateContactProperty } = await import('./update-contact-property.js');
  await executeUpdateContactProperty(
    db,
    run.contactId,
    { propertyName: config.outputProperty, value: classification },
    mergeContext,
  );
}
```

- [ ] **Step 4: Update the test to import from the executor**

Replace the inline `extractClassification` function definition in the test file with an import:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMergeTags } from '../services/workflow-merge-tags.js';
import { extractClassification } from '../services/step-executors/ai-classify.js';

describe('MergeContext var namespace', () => {
  // ... (keep existing tests unchanged)
});

describe('extractClassification', () => {
  it('returns exact match when response equals a category', () => {
    const result = extractClassification('hot_lead', ['hot_lead', 'cold_lead', 'nurture']);
    assert.equal(result, 'hot_lead');
  });

  it('is case-insensitive for exact match', () => {
    const result = extractClassification('Hot_Lead', ['hot_lead', 'cold_lead']);
    assert.equal(result, 'hot_lead');
  });

  it('falls back to partial match when response includes category', () => {
    const result = extractClassification('I classify this as cold_lead.', ['hot_lead', 'cold_lead']);
    assert.equal(result, 'cold_lead');
  });

  it('returns null when no category matches', () => {
    const result = extractClassification('unknown', ['hot_lead', 'cold_lead']);
    assert.equal(result, null);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-ai-steps.test.ts
```

Expected: 8 passing tests (4 var namespace + 4 classification).

- [ ] **Step 6: Register in `executeSingleStep`**

In `apps/api/src/services/workflow-executor.ts`, add import:

```ts
import { executeAiClassify, type AiClassifyConfig } from './step-executors/ai-classify.js';
```

Add case to the switch:

```ts
    case 'ai_classify':
      await executeAiClassify(
        db,
        run,
        config as unknown as AiClassifyConfig,
        mergeContext,
      );
      break;
```

- [ ] **Step 7: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/step-executors/ai-classify.ts apps/api/src/services/workflow-executor.ts apps/api/src/__tests__/workflow-ai-steps.test.ts
git commit -m "feat(workflows): add ai_classify step executor

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 5: `trigger_agent` executor

**Files:**
- Create: `apps/api/src/services/step-executors/trigger-agent.ts`
- Modify: `apps/api/src/services/workflow-executor.ts`
- Modify: `apps/api/src/__tests__/workflow-ai-steps.test.ts`

- [ ] **Step 1: Write the failing test first**

Add to `apps/api/src/__tests__/workflow-ai-steps.test.ts`:

```ts
// Pure helper: build Paperclip issue payload
function buildAgentTaskPayload(config: {
  agentId: string;
  taskTitle: string;
  message: string;
}, resolvedTitle: string, resolvedMessage: string): Record<string, unknown> {
  return {
    title: resolvedTitle,
    description: resolvedMessage,
    assigneeAgentId: config.agentId,
    status: 'todo',
  };
}

describe('buildAgentTaskPayload', () => {
  it('builds payload with resolved title and message', () => {
    const result = buildAgentTaskPayload(
      { agentId: 'agent-123', taskTitle: 'Task for {{contact.first_name}}', message: 'Hello' },
      'Task for Ana',
      'Hello',
    );
    assert.deepEqual(result, {
      title: 'Task for Ana',
      description: 'Hello',
      assigneeAgentId: 'agent-123',
      status: 'todo',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-ai-steps.test.ts
```

Expected: fails with `ReferenceError` or test failure for `buildAgentTaskPayload`.

- [ ] **Step 3: Create the executor**

Create `apps/api/src/services/step-executors/trigger-agent.ts`:

```ts
import type { WorkflowRun } from '@crm/db';
import type { MergeContext } from '../workflow-merge-tags.js';
import { resolveMergeTags } from '../workflow-merge-tags.js';

export interface TriggerAgentConfig {
  agentId: string;      // Paperclip agent ID to assign the task to
  taskTitle: string;    // task title template, supports merge tags
  message: string;      // task description template, supports merge tags
}

export async function executeTriggerAgent(
  _run: WorkflowRun,
  config: TriggerAgentConfig,
  mergeContext: MergeContext,
): Promise<void> {
  if (!config.agentId) throw new Error('trigger_agent: agentId is required');
  if (!config.taskTitle) throw new Error('trigger_agent: taskTitle is required');

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !apiKey || !companyId) {
    throw new Error(
      'trigger_agent: PAPERCLIP_API_URL, PAPERCLIP_API_KEY, and PAPERCLIP_COMPANY_ID env vars must be set',
    );
  }

  const resolvedTitle = resolveMergeTags(config.taskTitle, mergeContext);
  const resolvedMessage = resolveMergeTags(config.message ?? '', mergeContext);

  const response = await fetch(`${apiUrl}/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      title: resolvedTitle,
      description: resolvedMessage,
      assigneeAgentId: config.agentId,
      status: 'todo',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`trigger_agent: Paperclip API returned ${response.status}: ${body.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: Update test to import from executor**

Replace the inline `buildAgentTaskPayload` function in the test with an import, and update the test to use `resolveMergeTags` + the payload builder from a helper:

Since `buildAgentTaskPayload` is an internal detail of the executor (not exported), keep it as an inline pure function in the test. The test validates the merge tag resolution happens correctly — that's the only testable pure logic.

Update the test to instead test the integration of merge tag resolution:

```ts
describe('trigger_agent merge tag resolution', () => {
  it('resolves contact merge tags in title', () => {
    const ctx = { contact: { first_name: 'Ana', last_name: 'García' } };
    const template = 'Onboarding task for {{contact.first_name}} {{contact.last_name}}';
    const resolved = resolveMergeTags(template, ctx);
    assert.equal(resolved, 'Onboarding task for Ana García');
  });

  it('resolves var namespace in message', () => {
    const ctx = {
      contact: { first_name: 'Ana' },
      var: { ai_summary: 'Interested in premium plan' },
    };
    const template = '{{contact.first_name}} context: {{var.ai_summary}}';
    const resolved = resolveMergeTags(template, ctx);
    assert.equal(resolved, 'Ana context: Interested in premium plan');
  });
});
```

Remove the `buildAgentTaskPayload` describe block you added in Step 1 (replace it with the above).

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-ai-steps.test.ts
```

Expected: 10 passing tests.

- [ ] **Step 6: Register in `executeSingleStep`**

In `apps/api/src/services/workflow-executor.ts`, add import:

```ts
import { executeTriggerAgent, type TriggerAgentConfig } from './step-executors/trigger-agent.js';
```

Add case to the switch:

```ts
    case 'trigger_agent':
      await executeTriggerAgent(
        run,
        config as unknown as TriggerAgentConfig,
        mergeContext,
      );
      break;
```

- [ ] **Step 7: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Run all existing tests**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-filter.test.ts src/__tests__/workflow-enrollment.test.ts src/__tests__/workflow-time-triggers.test.ts src/__tests__/workflow-merge-tags.test.ts src/__tests__/workflow-ai-steps.test.ts
```

Expected: all pass (previously 60 + new tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/step-executors/trigger-agent.ts apps/api/src/services/workflow-executor.ts apps/api/src/__tests__/workflow-ai-steps.test.ts
git commit -m "feat(workflows): add trigger_agent step executor

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 6: Analytics endpoint

**Files:**
- Modify: `apps/api/src/routes/workflows.ts`

- [ ] **Step 1: Add required Drizzle imports**

In `apps/api/src/routes/workflows.ts`, add to the existing Drizzle imports at the top:

```ts
import { count, countDistinct, sql } from 'drizzle-orm';
```

(Add only what is not already imported. Check the existing import line from `drizzle-orm`.)

Also ensure `workflowStepLogs` is imported from `@crm/db` (it should be already — check the `@crm/db` import line).

- [ ] **Step 2: Add the analytics route**

Add after the existing `GET /api/workflows/:id` route (before the `POST` routes). The right place is after the existing `app.get('/api/workflows/:id', ...)` handler:

```ts
  // GET /api/workflows/:id/analytics — run stats and step completion rates
  app.get('/api/workflows/:id/analytics', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [wf] = await app.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .limit(1);

    if (!wf) return reply.code(404).send({ error: 'workflow_not_found' });

    // Aggregate run counts by status
    const runStats = await app.db
      .select({
        status: workflowRuns.status,
        cnt: count(),
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .groupBy(workflowRuns.status);

    const statsByStatus = Object.fromEntries(runStats.map((r) => [r.status, Number(r.cnt)]));
    const totalRuns = runStats.reduce((sum, r) => sum + Number(r.cnt), 0);

    // Runs per day — last 30 days
    const runsByDay = await app.db
      .select({
        date: sql<string>`DATE(${workflowRuns.startedAt})`.as('date'),
        cnt: count(),
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, id),
          sql`${workflowRuns.startedAt} >= NOW() - INTERVAL '30 days'`,
        ),
      )
      .groupBy(sql`DATE(${workflowRuns.startedAt})`)
      .orderBy(sql`DATE(${workflowRuns.startedAt})`);

    // Step stats — success/error counts per step type
    const stepStats = await app.db
      .select({
        stepType: workflowStepLogs.stepType,
        result: workflowStepLogs.result,
        cnt: count(),
      })
      .from(workflowStepLogs)
      .innerJoin(workflowRuns, eq(workflowStepLogs.runId, workflowRuns.id))
      .where(eq(workflowRuns.workflowId, id))
      .groupBy(workflowStepLogs.stepType, workflowStepLogs.result);

    // Reshape step stats into { stepType: { ok: N, error: N } }
    const stepStatsMap: Record<string, { ok: number; error: number }> = {};
    for (const row of stepStats) {
      if (!stepStatsMap[row.stepType]) stepStatsMap[row.stepType] = { ok: 0, error: 0 };
      if (row.result === 'ok') stepStatsMap[row.stepType]!.ok = Number(row.cnt);
      if (row.result === 'error') stepStatsMap[row.stepType]!.error = Number(row.cnt);
    }

    const completedRuns = statsByStatus['completed'] ?? 0;
    const failedRuns = statsByStatus['failed'] ?? 0;
    const activeRuns = (statsByStatus['running'] ?? 0) + (statsByStatus['sleeping'] ?? 0);

    return reply.send({
      totalRuns,
      activeRuns,
      completedRuns,
      failedRuns,
      completionRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
      runsByDay: runsByDay.map((r) => ({ date: r.date, count: Number(r.cnt) })),
      stepStats: stepStatsMap,
    });
  });
```

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors. If `count` or `sql` are not imported, add them.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/workflows.ts
git commit -m "feat(workflows): add analytics endpoint GET /api/workflows/:id/analytics

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 7: Bulk enrollment endpoint

**Files:**
- Modify: `apps/api/src/routes/workflows.ts`

- [ ] **Step 1: Add the bulk enrollment route**

Add after the existing `POST /api/workflows/:id/enroll` handler:

```ts
  // POST /api/workflows/:id/enroll-bulk — enroll multiple contacts at once
  app.post('/api/workflows/:id/enroll-bulk', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { contactIds?: string[] };

    if (!body.contactIds || !Array.isArray(body.contactIds) || body.contactIds.length === 0) {
      return reply.code(400).send({ error: 'contactIds array is required and must be non-empty' });
    }

    // Cap at 500 contacts per call to avoid runaway operations
    if (body.contactIds.length > 500) {
      return reply.code(400).send({ error: 'contactIds must contain at most 500 entries' });
    }

    const [workflow] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.status, 'active'), isNull(workflows.deletedAt)))
      .limit(1);

    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found_or_not_active' });

    let enrolled = 0;
    let skipped = 0;

    for (const contactId of body.contactIds) {
      try {
        // Respect enrollment mode
        const allowed = await checkEnrollmentAllowed(app.db, id, contactId, workflow.enrollmentMode);
        if (!allowed) {
          skipped++;
          continue;
        }

        // Record enrollment
        await app.db
          .insert(workflowEnrollments)
          .values({ workflowId: id, contactId })
          .onConflictDoUpdate({
            target: [workflowEnrollments.workflowId, workflowEnrollments.contactId],
            set: { lastEnrolledAt: new Date() },
          });

        // Create run
        const [run] = await app.db
          .insert(workflowRuns)
          .values({ workflowId: id, contactId, status: 'running' })
          .returning();

        if (run) {
          executeRun(app.db, run.id).catch((err) => {
            app.log.error({ err, runId: run.id }, 'Bulk enrollment run failed');
          });
          enrolled++;
        }
      } catch (err) {
        app.log.error({ err, contactId }, 'Bulk enrollment: error processing contact');
        skipped++;
      }
    }

    return reply.code(200).send({ enrolled, skipped });
  });
```

Note: `checkEnrollmentAllowed` is already imported from `workflow-engine.ts` at the top of the routes file (it was added in Phase 2). Verify this import exists — if it doesn't, add it:

```ts
import { checkEnrollmentAllowed } from '../services/workflow-engine.js';
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run all tests**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-filter.test.ts src/__tests__/workflow-enrollment.test.ts src/__tests__/workflow-time-triggers.test.ts src/__tests__/workflow-merge-tags.test.ts src/__tests__/workflow-ai-steps.test.ts
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/workflows.ts
git commit -m "feat(workflows): add bulk enrollment endpoint POST /api/workflows/:id/enroll-bulk

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 8: Frontend — step editor updates

**Files:**
- Modify: `apps/web/src/components/WorkflowStepEditor.tsx`

- [ ] **Step 1: Add new step types to `STEP_TYPE_OPTIONS`**

In `apps/web/src/components/WorkflowStepEditor.tsx`, append to the `STEP_TYPE_OPTIONS` array (after `unenroll_from_workflow`):

```ts
const STEP_TYPE_OPTIONS = [
  // ... existing entries unchanged ...
  { value: 'unenroll_from_workflow', label: 'Desinscriure de workflow' },
  { value: 'trigger_agent', label: 'Activar agent IA' },
  { value: 'request_ai_content', label: 'Generar contingut IA' },
  { value: 'ai_classify', label: 'Classificar amb IA' },
];
```

- [ ] **Step 2: Add icons**

Add to `STEP_ICONS`:

```ts
const STEP_ICONS: Record<string, string> = {
  // ... existing entries unchanged ...
  enroll_in_workflow: '↪️',
  unenroll_from_workflow: '↩️',
  trigger_agent: '🤖',
  request_ai_content: '✨',
  ai_classify: '🏷️',
};
```

- [ ] **Step 3: Add default configs**

Add to `defaultConfig`:

```ts
function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    // ... existing cases unchanged ...
    case 'unenroll_from_workflow': return { targetWorkflowId: '' };
    case 'trigger_agent': return { agentId: '', taskTitle: 'Tasca per {{contact.first_name}} {{contact.last_name}}', message: '' };
    case 'request_ai_content': return { prompt: 'Escriu un missatge de benvinguda personalitzat per {{contact.first_name}}', outputVariable: 'ai_content', model: 'claude-haiku-4-5-20251001' };
    case 'ai_classify': return { categories: ['hot_lead', 'cold_lead', 'nurture'], prompt: 'Classifica aquest contacte: {{contact.first_name}} {{contact.last_name}}, email: {{contact.email}}', outputProperty: 'lead_category' };
    default: return {};
  }
}
```

- [ ] **Step 4: Add config summaries**

Add to `configSummary`:

```ts
function configSummary(step: WorkflowStep): string {
  const c = step.config;
  switch (step.type) {
    // ... existing cases unchanged ...
    case 'unenroll_from_workflow': return `workflow: ${c.targetWorkflowId}`;
    case 'trigger_agent': return `agent: ${c.agentId} | "${c.taskTitle}"`;
    case 'request_ai_content': return `prompt → {{var.${c.outputVariable}}}`;
    case 'ai_classify': return `→ ${c.outputProperty}: [${(c.categories as string[] | undefined)?.join('|') ?? '...'}]`;
    default: return JSON.stringify(c).slice(0, 60);
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/WorkflowStepEditor.tsx
git commit -m "feat(workflows): add AI step types to step editor UI

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 9: Frontend — Analytics tab

**Files:**
- Modify: `apps/web/src/pages/WorkflowEditorPage.tsx`

- [ ] **Step 1: Add 'analytics' to the `Tab` type**

In `apps/web/src/pages/WorkflowEditorPage.tsx`, update:

```ts
type Tab = 'config' | 'executions' | 'analytics';
```

- [ ] **Step 2: Update the tab bar**

Change the tab bar to include the analytics tab:

```tsx
{/* Tabs */}
<div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e0e0e0', marginBottom: 24 }}>
  {(['config', 'executions', 'analytics'] as Tab[]).map((t) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      style={{
        padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
        borderBottom: tab === t ? '2px solid #1a73e8' : '2px solid transparent',
        color: tab === t ? '#1a73e8' : '#555', fontWeight: tab === t ? 600 : 400,
      }}
    >
      {t === 'config' ? 'Configuració' : t === 'executions' ? 'Execucions' : 'Analítica'}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Add the analytics tab content**

Add after the `{tab === 'executions' && ...}` block:

```tsx
{tab === 'analytics' && (
  <AnalyticsTab workflowId={wf.id} />
)}
```

- [ ] **Step 4: Add the `AnalyticsTab` component**

Add below the existing `ExecutionsTab` function:

```tsx
function AnalyticsTab({ workflowId }: { workflowId: string }) {
  const [data, setData] = useState<{
    totalRuns: number;
    activeRuns: number;
    completedRuns: number;
    failedRuns: number;
    completionRate: number;
    runsByDay: { date: string; count: number }[];
    stepStats: Record<string, { ok: number; error: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/workflows/${workflowId}/analytics`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [workflowId]);

  if (loading) return <div style={{ color: '#888', fontSize: 13 }}>Carregant...</div>;
  if (!data) return <div style={{ color: '#c00', fontSize: 13 }}>Error carregant analítica.</div>;

  return (
    <div style={{ fontSize: 14 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total execucions', value: data.totalRuns },
          { label: 'Actives', value: data.activeRuns },
          { label: 'Completades', value: data.completedRuns },
          { label: 'Fallades', value: data.failedRuns },
          { label: 'Taxa d\'èxit', value: `${data.completionRate}%` },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 8,
              padding: '12px 20px', minWidth: 120, textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Runs per day (last 30 days) */}
      {data.runsByDay.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#555' }}>Execucions — darrers 30 dies</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600 }}>Data</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>Execucions</th>
              </tr>
            </thead>
            <tbody>
              {data.runsByDay.map((row) => (
                <tr key={row.date} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '4px 8px' }}>{row.date}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Per-step stats */}
      {Object.keys(data.stepStats).length > 0 && (
        <section>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#555' }}>Estadístiques per pas</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600 }}>Tipus de pas</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: '#2a7a2a' }}>OK</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: '#c00' }}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.stepStats).map(([type, stats]) => (
                <tr key={type} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{type}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: '#2a7a2a' }}>{stats.ok}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: stats.error > 0 ? '#c00' : '#888' }}>{stats.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.totalRuns === 0 && (
        <div style={{ color: '#888', fontSize: 13 }}>Cap execució registrada per a aquest workflow.</div>
      )}
    </div>
  );
}
```

Make sure `useEffect` and `useState` are imported at the top (they should already be for `WorkflowEditorPage`).

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/WorkflowEditorPage.tsx
git commit -m "feat(workflows): add analytics tab to workflow editor

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 10: Frontend — Bulk enrollment modal

**Files:**
- Modify: `apps/web/src/pages/WorkflowEditorPage.tsx`

- [ ] **Step 1: Add bulk enrollment state**

In `WorkflowEditorPage`, add new state variables near the existing `useState` declarations:

```ts
const [showBulkEnroll, setShowBulkEnroll] = useState(false);
const [bulkContactIds, setBulkContactIds] = useState('');
const [bulkResult, setBulkResult] = useState<{ enrolled: number; skipped: number } | null>(null);
const [bulkLoading, setBulkLoading] = useState(false);
```

- [ ] **Step 2: Add "Enroll contacts" button to the header**

In the workflow editor header area (currently has the workflow name + status), add the button. Find the header section (the part with publish/unpublish buttons) and add a bulk enroll button that only shows for active workflows:

```tsx
{wf.status === 'active' && canEdit && (
  <button
    onClick={() => { setShowBulkEnroll(true); setBulkResult(null); setBulkContactIds(''); }}
    style={{
      padding: '7px 14px', background: '#fff', border: '1px solid #1a73e8',
      color: '#1a73e8', borderRadius: 4, cursor: 'pointer', fontSize: 13,
    }}
  >
    Inscriure contactes
  </button>
)}
```

Place this button alongside the existing publish/unpublish buttons (before or after them).

- [ ] **Step 3: Add the bulk enrollment modal**

Add at the bottom of the `WorkflowEditorPage` return (before the closing `</div>`):

```tsx
{showBulkEnroll && (
  <div
    style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) setShowBulkEnroll(false); }}
  >
    <div style={{ background: '#fff', borderRadius: 8, padding: 28, width: 480, maxWidth: '90vw' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Inscriure contactes al workflow</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#555' }}>
        Enganxa els IDs de contacte (un per línia o separats per comes). Màxim 500.
      </p>
      <textarea
        value={bulkContactIds}
        onChange={(e) => setBulkContactIds(e.target.value)}
        placeholder="uuid-1\nuuid-2\nuuid-3..."
        rows={6}
        style={{ width: '100%', boxSizing: 'border-box', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontSize: 13, fontFamily: 'monospace' }}
      />
      {bulkResult && (
        <div style={{ marginTop: 10, fontSize: 13, color: bulkResult.enrolled > 0 ? '#2a7a2a' : '#888' }}>
          ✓ {bulkResult.enrolled} inscrits, {bulkResult.skipped} omesos
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          onClick={() => setShowBulkEnroll(false)}
          style={{ padding: '7px 16px', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
        >
          Tancar
        </button>
        <button
          disabled={bulkLoading || !bulkContactIds.trim()}
          onClick={async () => {
            const ids = bulkContactIds
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean);
            if (ids.length === 0) return;
            setBulkLoading(true);
            try {
              const res = await api(`/api/workflows/${wf.id}/enroll-bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactIds: ids }),
              });
              if (res.ok) {
                const data = await res.json();
                setBulkResult(data);
              } else {
                const err = await res.json();
                alert(`Error: ${err.error ?? 'unknown'}`);
              }
            } finally {
              setBulkLoading(false);
            }
          }}
          style={{
            padding: '7px 16px', background: bulkLoading ? '#aaa' : '#1a73e8',
            border: 'none', color: '#fff', borderRadius: 4, cursor: bulkLoading ? 'not-allowed' : 'pointer', fontSize: 13,
          }}
        >
          {bulkLoading ? 'Inscrivint...' : 'Inscriure'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run all tests**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-filter.test.ts src/__tests__/workflow-enrollment.test.ts src/__tests__/workflow-time-triggers.test.ts src/__tests__/workflow-merge-tags.test.ts src/__tests__/workflow-ai-steps.test.ts
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/WorkflowEditorPage.tsx
git commit -m "feat(workflows): add bulk enrollment modal to workflow editor

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Final Verification

- [ ] **Full typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors across all packages.

- [ ] **All tests**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-filter.test.ts src/__tests__/workflow-enrollment.test.ts src/__tests__/workflow-time-triggers.test.ts src/__tests__/workflow-merge-tags.test.ts src/__tests__/workflow-ai-steps.test.ts
```

Expected: all passing.

- [ ] **Migration ready**

Confirm `packages/db/migrations/0018_workflow_phase4.sql` exists and contains the `ALTER TYPE` and `ALTER TABLE` statements.

- [ ] **Submit for review**

When done, set status to `in_review` and @mention the Founding Engineer.

---

## Deployment Note

After merge, run `pnpm db:migrate` on the server to apply `0018_workflow_phase4.sql`.

Env vars required for AI steps (add to server environment if not present):
- `ANTHROPIC_API_KEY` — for `request_ai_content` and `ai_classify` steps
- `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID` — for `trigger_agent` steps (likely already set)
