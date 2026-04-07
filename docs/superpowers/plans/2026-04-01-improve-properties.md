# Property Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guard property deletion against in-use references, and replace hardcoded ContactDetailPage section groups with a dynamic `group` field on property definitions.

**Architecture:** Two independent features. (1) The DELETE handler in `properties.ts` queries `pipeline_stages.required_fields` and `form_fields.crm_property_key` before deleting and returns 409 if any reference exists. (2) A new nullable `group` column on `property_definitions` lets admins assign properties to named sections; `ContactDetailPage` reads that field instead of the static `PROP_GROUPS` array.

**Tech Stack:** PostgreSQL / Drizzle ORM, Fastify, React (TypeScript)

---

## Context: "Consulta" section

The "Consulta" section on ContactDetailPage is **not** a special field type — it groups two sensitive CRM properties:
- `consult_reason_code` — select field ("Motiu de consulta"), the reason category a patient is seeking consultation (pain, injury, post-surgery, etc.)
- `consult_reason_notes` — textarea ("Motiu de consulta - notes"), free-text notes about the reason

Both have `scope: 'both'` (show on contacts and deals) and `isSensitive: true`. Task 2 below will add a `group` field to these definitions so they're labeled "Consulta" dynamically rather than via hardcoded front-end logic.

---

## File Map

| File | Change |
|---|---|
| `packages/db/migrations/0010_property_group.sql` | CREATE — add `group` column, back-fill existing groups |
| `packages/db/migrations/meta/_journal.json` | MODIFY — add entry for 0010 |
| `packages/db/src/schema/properties.ts` | MODIFY — add `group` field to `propertyDefinitions` table |
| `apps/api/src/routes/properties.ts` | MODIFY — (a) deletion guard, (b) accept/return `group` |
| `apps/web/src/pages/ContactDetailPage.tsx` | MODIFY — remove static `PROP_GROUPS`, compute groups dynamically |
| `apps/web/src/pages/AdminPropertiesPage.tsx` | MODIFY — add `group` field to `PropertyDef`, form state, and form UI |

---

## Task 1: Deletion guard — API

**Files:**
- Modify: `apps/api/src/routes/properties.ts` (DELETE handler, lines ~136–160)

### Background

`pipeline_stages.required_fields` is a `jsonb` column typed as `string[]`. Each entry is a property key string (e.g. `"interaction_channel"`).

`form_fields.crm_property_key` is a nullable `text` column. Its Drizzle name is `crmPropertyKey`.

If either table references the property being deleted, the API must refuse with HTTP 409 and explain where it is used.

- [ ] **Step 1: Open the file**

Read `apps/api/src/routes/properties.ts`. Locate the `DELETE /api/properties/:id` handler (starts around line 136).

- [ ] **Step 2: Add imports**

At the top of the file, add `sql` to the drizzle-orm import and import the tables you need:

```typescript
import { inArray, asc, eq, sql } from 'drizzle-orm';
import { propertyDefinitions, formFields } from '@crm/db';
```

> `formFields` is exported from `@crm/db` (packages/db/src/schema/forms.ts). Verify the export name by checking `packages/db/src/schema/index.ts`.

- [ ] **Step 3: Replace the DELETE handler body**

Replace the handler body (keep the route signature and `preHandler` unchanged) with:

```typescript
async (req, reply) => {
  const { id } = req.params as { id: string };

  const existing = await app.db.query.propertyDefinitions.findFirst({
    where: eq(propertyDefinitions.id, id),
  });
  if (!existing) return reply.status(404).send({ error: 'Not found' });

  // Guard: check pipeline stage required_fields
  const stageRefs = await app.db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM pipeline_stages
        WHERE required_fields @> ${JSON.stringify([existing.key])}::jsonb`,
  );

  // Guard: check form fields
  const formRefs = await app.db
    .select({ id: formFields.id, label: formFields.label })
    .from(formFields)
    .where(eq(formFields.crmPropertyKey, existing.key));

  const usedIn: string[] = [
    ...stageRefs.rows.map((r) => `pipeline stage "${r.name}"`),
    ...formRefs.map((r) => `form field "${r.label ?? r.id}"`),
  ];

  if (usedIn.length > 0) {
    return reply.status(409).send({
      error: `Cannot delete property "${existing.key}" because it is in use: ${usedIn.join(', ')}.`,
    });
  }

  await app.db.delete(propertyDefinitions).where(eq(propertyDefinitions.id, id));

  await app.audit({
    userId: req.user!.id,
    action: 'delete',
    objectType: 'property_definition',
    objectId: id,
    diff: { before: existing as unknown as Record<string, unknown> },
  });

  return reply.status(204).send();
},
```

> Note: `app.db.execute` returns `{ rows: T[] }` with Drizzle's postgres-js driver. Adjust if the project uses a different driver — check how other routes call `app.db.execute` (e.g. in `deals.ts`).

- [ ] **Step 4: Verify `formFields.crmPropertyKey` export name**

Run:
```bash
cd packages/db && grep -n 'crmPropertyKey\|crm_property_key' src/schema/forms.ts
```

Expected output shows the column definition. If the Drizzle field name differs from `crmPropertyKey`, adjust the import/usage above.

- [ ] **Step 5: Manual smoke test**

Start the API (`pnpm --filter api dev`) and try deleting a property that is in use:
```bash
# Find a property key that appears in required_fields in seed, e.g. 'interaction_channel'
# Get its ID from the DB or via GET /api/properties?scope=all
curl -s -X DELETE http://localhost:3001/api/properties/<id> \
  -H "Authorization: Bearer <admin-token>"
```

Expected: HTTP 409 with a message naming the stage.

Try deleting a property that is NOT in use — expected: HTTP 204.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/properties.ts
git commit -m "feat(api): guard property deletion against in-use references

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 2: Add `group` column — DB migration + Drizzle schema

**Files:**
- Create: `packages/db/migrations/0010_property_group.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/properties.ts`

### Background

The three hardcoded groups in `ContactDetailPage.tsx` map to these property keys:
- **"Atribució"** — `first_lead_source`, `last_lead_source`, `first_meta_form`, `last_meta_form`, `first_page_url`, `last_page_url`, `first_utm_source`, `last_utm_source`, `first_utm_campaign`, `last_utm_campaign`, `first_utm_medium`, `last_utm_medium`, `first_submission_at`, `last_submission_at`
- **"Aircall"** — `last_aircall_call_outcome`, `last_aircall_call_timestamp`, `last_aircall_sms_direction`, `last_aircall_sms_timestamp`, `last_used_aircall_phone_number`, `last_used_aircall_tags`
- **"Consulta"** — `consult_reason_code`, `consult_reason_notes`

The migration adds the column AND back-fills these values so no data is lost.

- [ ] **Step 1: Create migration SQL**

Create `packages/db/migrations/0010_property_group.sql`:

```sql
-- Add group column to property_definitions
ALTER TABLE property_definitions ADD COLUMN "group" TEXT;

-- Back-fill groups from the existing hardcoded PROP_GROUPS in the front-end
UPDATE property_definitions SET "group" = 'Atribució'
WHERE key IN (
  'first_lead_source','last_lead_source',
  'first_meta_form','last_meta_form',
  'first_page_url','last_page_url',
  'first_utm_source','last_utm_source',
  'first_utm_campaign','last_utm_campaign',
  'first_utm_medium','last_utm_medium',
  'first_submission_at','last_submission_at'
);

UPDATE property_definitions SET "group" = 'Aircall'
WHERE key IN (
  'last_aircall_call_outcome','last_aircall_call_timestamp',
  'last_aircall_sms_direction','last_aircall_sms_timestamp',
  'last_used_aircall_phone_number','last_used_aircall_tags'
);

UPDATE property_definitions SET "group" = 'Consulta'
WHERE key IN ('consult_reason_code','consult_reason_notes');
```

- [ ] **Step 2: Add to journal**

Open `packages/db/migrations/meta/_journal.json`. Add a new entry at the end of the `entries` array, following the exact same structure as the `0009` entry. The new entry should have:
- `"idx"` — one higher than the previous entry's idx
- `"version"` — same value as the previous entry
- `"when"` — current Unix timestamp in milliseconds (use `Date.now()` in Node or any epoch converter)
- `"tag"` — `"0010_property_group"`
- `"breakpoints"` — `true`

- [ ] **Step 3: Update Drizzle schema**

In `packages/db/src/schema/properties.ts`, add `group` to the `propertyDefinitions` table definition (after `position`):

```typescript
group: text('group'),  // optional display group, e.g. 'Atribució', 'Aircall', 'Consulta'
```

Also update the exported types — Drizzle regenerates these automatically from the table definition, so no manual change needed beyond adding the column.

- [ ] **Step 4: Run the migration**

```bash
cd packages/db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/crm \
  npx drizzle-kit migrate
```

Expected: "0010_property_group" applied successfully.

- [ ] **Step 5: Verify**

```bash
psql postgres://postgres:postgres@localhost:5432/crm \
  -c "SELECT key, \"group\" FROM property_definitions WHERE \"group\" IS NOT NULL ORDER BY key;"
```

Expected: all back-filled properties show their group.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0010_property_group.sql \
        packages/db/migrations/meta/_journal.json \
        packages/db/src/schema/properties.ts
git commit -m "feat(db): add group column to property_definitions with back-fill

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 3: Expose `group` in the properties API

**Files:**
- Modify: `apps/api/src/routes/properties.ts`

- [ ] **Step 1: Accept `group` in POST body**

In the `POST /api/properties` handler, add `group` to the body type:

```typescript
const body = req.body as {
  key: string;
  label: string;
  scope: 'contact' | 'deal' | 'both';
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
  options?: Array<{ key: string; label: string }>;
  isRequired?: boolean;
  isInternalOnly?: boolean;
  isSensitive?: boolean;
  position?: string;
  group?: string;
};
```

In the `insert().values(...)` call, add:

```typescript
group: body.group ?? null,
```

- [ ] **Step 2: Accept `group` in PATCH body**

In the `PATCH /api/properties/:id` handler, add `group` to the body type:

```typescript
const body = req.body as {
  label?: string;
  scope?: 'contact' | 'deal' | 'both';
  type?: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
  options?: Array<{ key: string; label: string }>;
  isRequired?: boolean;
  isInternalOnly?: boolean;
  isSensitive?: boolean;
  position?: string;
  group?: string | null;
};
```

In the updates block (after `if (body.position !== undefined)`), add:

```typescript
if (body.group !== undefined) updates.group = body.group;
```

- [ ] **Step 3: Verify GET returns `group`**

The `GET /api/properties` handler uses `db.select().from(propertyDefinitions)` which returns all columns including the new `group`. No change needed — Drizzle picks it up automatically.

Run the API and hit:
```bash
curl -s http://localhost:3001/api/properties?scope=all \
  -H "Authorization: Bearer <token>" | jq '.[0]'
```

Expected: response object includes `"group": "Atribució"` (or `null`) for each property.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/properties.ts
git commit -m "feat(api): accept and return group field on property definitions

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 4: Dynamic groups in ContactDetailPage

**Files:**
- Modify: `apps/web/src/pages/ContactDetailPage.tsx`

### Goal

Remove the static `PROP_GROUPS` array. Compute display groups from the `group` field on the loaded `PropertyDef` objects. Properties with `group = null` are shown ungrouped (after the core fields). The rendering behaviour is unchanged.

- [ ] **Step 1: Update PropertyDef interface**

Find the `PropertyDef` interface in `ContactDetailPage.tsx` and add `group`:

```typescript
interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: string;
  scope: string;
  options: Array<{ key: string; label: string }> | null;
  isSensitive: boolean;
  group: string | null;
}
```

- [ ] **Step 2: Delete PROP_GROUPS**

Remove the entire `const PROP_GROUPS: ...` block (lines 49–74 approximately). Do not remove `CORE_KEYS`.

- [ ] **Step 3: Compute groups from propDefs**

After `setPropDefs(defs)` (or wherever propDefs is set), derive the groups in the render. Find the section of the render that iterates over `PROP_GROUPS` (it will be something like `PROP_GROUPS.map((group) => ...)`). Replace the static `PROP_GROUPS.map(...)` iteration with a dynamically-computed equivalent.

To build the dynamic groups, add a derived variable inside the component render (not in a `useEffect` — this can just be a `const` computed on each render):

```typescript
// Build display groups from property definitions
const displayGroups: { label: string; keys: string[] }[] = [];
const groupOrder: string[] = [];
const groupMap = new Map<string, string[]>();

for (const def of propDefs) {
  if (!def.group || CORE_KEYS.includes(def.key)) continue;
  if (!groupMap.has(def.group)) {
    groupMap.set(def.group, []);
    groupOrder.push(def.group);
  }
  groupMap.get(def.group)!.push(def.key);
}

for (const label of groupOrder) {
  displayGroups.push({ label, keys: groupMap.get(label)! });
}

// Properties with no group and not in CORE_KEYS — shown at bottom ungrouped
const ungroupedKeys = propDefs
  .filter((d) => !d.group && !CORE_KEYS.includes(d.key))
  .map((d) => d.key);
if (ungroupedKeys.length > 0) {
  displayGroups.push({ label: '', keys: ungroupedKeys });
}
```

Then replace `PROP_GROUPS.map(...)` in the JSX with `displayGroups.map(...)`. The inner rendering code (filtering, `defFor()`, `displayVal()`, edit inputs) stays exactly the same — only the data source changes.

> **Important:** `displayGroups` entries with `label: ''` (ungrouped) should not render a section heading. Add a guard in the JSX:
> ```tsx
> {group.label && <h3 className="...">{group.label}</h3>}
> ```

- [ ] **Step 4: Verify in browser**

Start the web app (`pnpm --filter web dev`). Open a contact detail page. Confirm:
- "Atribució", "Aircall", and "Consulta" sections still appear as before
- Order matches the property `position` order in the DB (groups appear in the order the first member of each group appears in the sorted prop list)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ContactDetailPage.tsx
git commit -m "feat(web): compute contact property groups dynamically from definitions

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 5: `group` field in AdminPropertiesPage

**Files:**
- Modify: `apps/web/src/pages/AdminPropertiesPage.tsx`

### Goal

Add `group` to the PropertyDef interface, the form state type, `emptyForm()`, `startEdit()`, the form UI (a text input), the save (POST/PATCH) body, and the property table display.

- [ ] **Step 1: Update PropertyDef interface**

Find the `PropertyDef` interface and add:

```typescript
group: string | null;
```

- [ ] **Step 2: Update FormState type and emptyForm**

Find `FormState` (or the inline type used for `form` state) and add:

```typescript
group: string;
```

In `emptyForm()`, add:

```typescript
group: '',
```

- [ ] **Step 3: Update startEdit to populate group**

In `startEdit(def)`, add to the `setForm(...)` call:

```typescript
group: def.group ?? '',
```

- [ ] **Step 4: Add group input to the form UI**

In the create/edit modal form, after the `position` field, add:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    Grup de display
  </label>
  <input
    type="text"
    value={form.group}
    onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
    placeholder="p.ex. Atribució, Aircall, Consulta"
    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
  />
  <p className="text-xs text-gray-500 mt-1">
    Deixa en blanc si no cal agrupar. Els noms de grup han de coincidir exactament.
  </p>
</div>
```

- [ ] **Step 5: Include group in save payload**

In the save function (`handleSave` or equivalent), where the POST/PATCH body is built, add:

```typescript
group: form.group || null,
```

- [ ] **Step 6: Show group in the table**

In the property table, add a "Grup" column header and render `def.group ?? '—'` in each row. Follow the same pattern as the existing "Posició" column.

- [ ] **Step 7: Verify in browser**

Open `/admin/properties`. Confirm:
- Table shows a "Grup" column with values like "Atribució", "Aircall", "Consulta"
- Edit a property and change its group — save and reload — confirm the group persists
- Create a new property with a custom group — confirm it shows in ContactDetailPage grouped correctly

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/AdminPropertiesPage.tsx
git commit -m "feat(web): add group field to property admin UI

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Self-Review Checklist

- [x] **Consulta question** — answered in context section above; no code change needed
- [x] **Deletion guard** — Task 1 checks both `pipeline_stages.required_fields` and `form_fields.crm_property_key`
- [x] **Dynamic groups** — Tasks 2–5 add the DB column, API support, and both front-end pages
- [x] **Back-fill** — migration back-fills existing grouped properties so ContactDetailPage still shows three named sections immediately after deploy
- [x] **No PROP_GROUPS drift** — removing the hardcoded array means future group changes only require an admin UI update, not a code deploy
- [x] **No placeholder steps** — all code shown in full
- [x] **Type consistency** — `group: string | null` used in DB schema, API body types, and both React interfaces
