# Improve Deals in the CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make kanban the default deals view, and allow admins to configure required-field gates per pipeline stage.

**Architecture:** Two independent changes. (1) A DB migration flips the `default_view` column default to `'kanban'` and back-fills existing rows; the Drizzle schema and the two frontend fallback strings follow. (2) The stage required-fields feature already has DB storage and API validation — only the admin-facing write path (PATCH stage) and the AdminPipelinesPage UI are missing; we add both.

**Tech Stack:** PostgreSQL, Drizzle ORM, Fastify (TypeScript), React (TypeScript), no extra dependencies needed.

---

## Files

| File | Action | Purpose |
|---|---|---|
| `packages/db/migrations/0009_pipeline_kanban_default.sql` | Create | Migration: flip default + back-fill |
| `packages/db/migrations/meta/_journal.json` | Modify | Register migration idx 8 |
| `packages/db/src/schema/pipelines.ts` | Modify | Drizzle default `'list'` → `'kanban'` |
| `apps/web/src/pages/DealsListPage.tsx` | Modify | Two fallback strings `'list'` → `'kanban'` |
| `apps/api/src/routes/pipelines.ts` | Modify | Accept `requiredFields` in PATCH stage body |
| `apps/web/src/pages/AdminPipelinesPage.tsx` | Modify | Show + edit `requiredFields` per stage |

---

## Task 1 — DB migration: kanban as default

**Files:**
- Create: `packages/db/migrations/0009_pipeline_kanban_default.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Create the migration file**

  Create `packages/db/migrations/0009_pipeline_kanban_default.sql` with:

  ```sql
  -- Change the column default so new pipelines start as kanban
  ALTER TABLE pipelines ALTER COLUMN default_view SET DEFAULT 'kanban';

  -- Back-fill existing pipelines that were never explicitly changed from 'list'
  UPDATE pipelines SET default_view = 'kanban' WHERE default_view = 'list';
  ```

- [ ] **Step 2: Register the migration in the journal**

  Open `packages/db/migrations/meta/_journal.json`. Add one entry at the end of the `entries` array (keep the trailing format consistent):

  ```json
  { "idx": 8, "version": "7", "when": 8, "tag": "0009_pipeline_kanban_default", "breakpoints": true }
  ```

  The full file should now look like:

  ```json
  {
    "version": "7",
    "dialect": "postgresql",
    "entries": [
      { "idx": 0, "version": "7", "when": 0, "tag": "0001_initial",                  "breakpoints": true },
      { "idx": 1, "version": "7", "when": 1, "tag": "0002_audit_logs",               "breakpoints": true },
      { "idx": 2, "version": "7", "when": 2, "tag": "0003_notes_tasks",              "breakpoints": true },
      { "idx": 3, "version": "7", "when": 3, "tag": "0004_deal_external_id",         "breakpoints": true },
      { "idx": 4, "version": "7", "when": 4, "tag": "0005_seed",                     "breakpoints": true },
      { "idx": 5, "version": "7", "when": 5, "tag": "0006_pipeline_default_view",    "breakpoints": true },
      { "idx": 6, "version": "7", "when": 6, "tag": "0007_forms",                    "breakpoints": true },
      { "idx": 7, "version": "7", "when": 7, "tag": "0008_form_field_visible",       "breakpoints": true },
      { "idx": 8, "version": "7", "when": 8, "tag": "0009_pipeline_kanban_default",  "breakpoints": true }
    ]
  }
  ```

- [ ] **Step 3: Update the Drizzle schema to match**

  In `packages/db/src/schema/pipelines.ts`, line 17, change the default from `'list'` to `'kanban'`:

  ```ts
  // Before
  defaultView: text('default_view').notNull().default('list'), // 'list' | 'kanban'

  // After
  defaultView: text('default_view').notNull().default('kanban'), // 'list' | 'kanban'
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add packages/db/migrations/0009_pipeline_kanban_default.sql \
          packages/db/migrations/meta/_journal.json \
          packages/db/src/schema/pipelines.ts
  git commit -m "feat(db): default pipeline view to kanban, back-fill existing rows

  Co-Authored-By: Paperclip <noreply@paperclip.ing>"
  ```

---

## Task 2 — Frontend: kanban as default fallback

**Files:**
- Modify: `apps/web/src/pages/DealsListPage.tsx` (lines 98 and 157)

- [ ] **Step 1: Update the React state initial value (line 98)**

  ```tsx
  // Before
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // After
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  ```

- [ ] **Step 2: Update the nullish-coalesce fallback (line 157)**

  ```tsx
  // Before
  setViewMode(ps[0].defaultView ?? 'list');

  // After
  setViewMode(ps[0].defaultView ?? 'kanban');
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/pages/DealsListPage.tsx
  git commit -m "feat(web): default deals view to kanban

  Co-Authored-By: Paperclip <noreply@paperclip.ing>"
  ```

---

## Task 3 — API: expose requiredFields on stage PATCH

**Files:**
- Modify: `apps/api/src/routes/pipelines.ts` (lines 188–218)

- [ ] **Step 1: Add `requiredFields` to the body type and updates object**

  Replace the PATCH stage handler body (lines 188–218). The full updated handler:

  ```ts
  // -------------------------------------------------------------- update stage
  app.patch(
    '/api/pipelines/:pipelineId/stages/:stageId',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { pipelineId, stageId } = req.params as { pipelineId: string; stageId: string };
      const body = req.body as {
        name?: string;
        position?: number;
        isClosedWon?: boolean;
        isClosedLost?: boolean;
        requiredFields?: string[];
      };

      const [existing] = await app.db
        .select()
        .from(stages)
        .where(eq(stages.id, stageId))
        .limit(1);
      if (!existing || existing.pipelineId !== pipelineId) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const updates: Partial<typeof stages.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.position !== undefined) updates.position = body.position;
      if (body.isClosedWon !== undefined) updates.isClosedWon = body.isClosedWon;
      if (body.isClosedLost !== undefined) updates.isClosedLost = body.isClosedLost;
      if (body.requiredFields !== undefined) updates.requiredFields = body.requiredFields;

      const [updated] = await app.db
        .update(stages)
        .set(updates)
        .where(eq(stages.id, stageId))
        .returning();

      return updated;
    },
  );
  ```

- [ ] **Step 2: Manual smoke-test (optional but fast)**

  Start the API (`pnpm --filter api dev` or however the project runs), then:

  ```bash
  # replace <pipelineId> and <stageId> with real UUIDs from the DB
  curl -s -X PATCH http://localhost:3101/api/pipelines/<pipelineId>/stages/<stageId> \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <admin-token>" \
    -d '{"requiredFields": ["owner_user_id"]}' | jq .requiredFields
  # expected: ["owner_user_id"]
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/api/src/routes/pipelines.ts
  git commit -m "feat(api): accept requiredFields on stage PATCH

  Co-Authored-By: Paperclip <noreply@paperclip.ing>"
  ```

---

## Task 4 — Admin UI: view and edit required fields per stage

**Files:**
- Modify: `apps/web/src/pages/AdminPipelinesPage.tsx`

This task has several sub-changes. Apply them all before committing.

- [ ] **Step 1: Add `requiredFields` to the `Stage` interface (line 4)**

  ```tsx
  interface Stage {
    id: string;
    name: string;
    slug: string;
    position: number;
    isClosedWon: boolean;
    isClosedLost: boolean;
    requiredFields: string[];
  }
  ```

- [ ] **Step 2: Add `dealProps` state and a `DealProp` type near the top of the component**

  Add just after the existing imports:

  ```tsx
  interface DealProp {
    id: string;
    key: string;
    label: string;
  }
  ```

  Add inside `AdminPipelinesPage()`, near the other `useState` declarations (e.g. after line 52):

  ```tsx
  const [dealProps, setDealProps] = useState<DealProp[]>([]);
  ```

  And add `editingStageRequiredFields` state next to the other editing-stage states (after line 47):

  ```tsx
  const [editingStageRequiredFields, setEditingStageRequiredFields] = useState<string[]>([]);
  ```

- [ ] **Step 3: Fetch deal properties on mount**

  In the existing `load()` function (currently only fetches `/api/pipelines`), add a parallel fetch for deal properties. Replace the `load` function:

  ```tsx
  function load() {
    setLoading(true);
    Promise.all([
      api.get('/api/pipelines'),
      api.get('/api/properties?scope=deal'),
    ])
      .then(([pipelineData, propData]) => {
        setPipelines(pipelineData);
        setDealProps(propData);
        setError('');
      })
      .catch(() => setError('Error carregant els pipelines.'))
      .finally(() => setLoading(false));
  }
  ```

  *(The `useEffect(() => { load(); }, [])` call on line 62 stays unchanged.)*

- [ ] **Step 4: Populate `editingStageRequiredFields` when opening stage edit**

  In the "Editar" button `onClick` handler (currently around line 376–381), add `setEditingStageRequiredFields`:

  ```tsx
  onClick={() => {
    setEditingStageId(stage.id);
    setEditingStageName(stage.name);
    setEditingStageClosedWon(stage.isClosedWon);
    setEditingStageClosedLost(stage.isClosedLost);
    setEditingStageRequiredFields(stage.requiredFields ?? []);
  }}
  ```

- [ ] **Step 5: Include `requiredFields` in `handleSaveStage`**

  Replace the existing `handleSaveStage` function (lines 172–185):

  ```tsx
  async function handleSaveStage(pipelineId: string, stageId: string) {
    if (!editingStageName.trim()) return;
    try {
      await api.patch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
        name: editingStageName.trim(),
        isClosedWon: editingStageClosedWon,
        isClosedLost: editingStageClosedLost,
        requiredFields: editingStageRequiredFields,
      });
      setEditingStageId(null);
      load();
    } catch {
      setError('Error actualitzant l\'etapa.');
    }
  }
  ```

- [ ] **Step 6: Add required-fields multi-checkbox to the stage edit form**

  Inside the `editingStageId === stage.id` branch of the stage row (the inline edit form, around line 327), add the checkbox list **after** the two existing `isClosedWon`/`isClosedLost` labels and before the Guardar/Cancel·lar buttons:

  ```tsx
  {dealProps.length > 0 && (
    <div style={{ width: '100%', marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 4 }}>
        Camps obligatoris per entrar en aquesta etapa:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {dealProps.map((prop) => (
          <label key={prop.key} style={checkLabel}>
            <input
              type="checkbox"
              checked={editingStageRequiredFields.includes(prop.key)}
              onChange={(e) => {
                if (e.target.checked) {
                  setEditingStageRequiredFields((prev) => [...prev, prop.key]);
                } else {
                  setEditingStageRequiredFields((prev) => prev.filter((k) => k !== prop.key));
                }
              }}
            />
            {prop.label}
          </label>
        ))}
      </div>
    </div>
  )}
  ```

  Place this block right before the `<button onClick={() => handleSaveStage(...)}>Guardar</button>` line.

- [ ] **Step 7: Display required fields as tags in the read-only stage row**

  Inside the non-editing branch of the stage row (around line 354), add a tag list after the existing `{stage.isClosedLost && ...}` badge:

  ```tsx
  {(stage.requiredFields ?? []).map((key) => {
    const prop = dealProps.find((p) => p.key === key);
    return (
      <span key={key} style={badge('blue')}>
        {prop?.label ?? key}
      </span>
    );
  })}
  ```

  Then add a `'blue'` case to the existing `badge()` helper function at the bottom of the file:

  ```tsx
  function badge(color: 'green' | 'red' | 'blue'): React.CSSProperties {
    return {
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 6px',
      borderRadius: 10,
      background: color === 'green' ? '#e6f4ea' : color === 'red' ? '#fde8e8' : '#e8f0fe',
      color: color === 'green' ? '#2d7a3a' : color === 'red' ? '#c0392b' : '#1a56db',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    };
  }
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add apps/web/src/pages/AdminPipelinesPage.tsx
  git commit -m "feat(web): admin UI to view and edit stage required fields

  Co-Authored-By: Paperclip <noreply@paperclip.ing>"
  ```

---

## Spec coverage check

| Requirement | Covered by |
|---|---|
| Kanban view by default | Task 1 (DB migration + back-fill + schema), Task 2 (frontend fallback) |
| Stage-transition requirements — admin can define mandatory properties | Task 3 (API write path), Task 4 (admin UI read + write) |
| Existing validation at transition enforced | Already implemented — no change needed |
| Existing frontend validation error display | Already implemented — no change needed |
