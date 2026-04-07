# Form Improvements (CEN-121) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three improvements to the forms module: (1) hide the form name from the public embed view, (2) add a per-field visibility toggle so admins can force hidden fields, (3) make the CRM field mapping dropdown show all contact properties instead of just 4.

**Architecture:** The changes span the DB layer (one additive migration for `is_visible`), the API layer (embed endpoint filters hidden fields; update route accepts `isVisible`; submit route skips required validation for hidden fields), and the React frontend (editor gains a visibility checkbox and dynamic CRM property options; embed page removes the name header and filters hidden fields).

**Tech Stack:** PostgreSQL + Drizzle ORM, Fastify, React + TypeScript (no test framework in place — manual verification only)

---

## File Map

| File | Change |
|------|--------|
| `packages/db/migrations/0008_form_field_visible.sql` | **CREATE** — ALTER TABLE migration |
| `packages/db/migrations/meta/_journal.json` | **MODIFY** — add entry for 0008 |
| `packages/db/src/schema/forms.ts` | **MODIFY** — add `isVisible` to `formFields` table definition |
| `apps/api/src/routes/forms.ts` | **MODIFY** — embed filters hidden fields; update route accepts isVisible; submit skips required check for hidden fields |
| `apps/web/src/pages/FormEmbedPage.tsx` | **MODIFY** — remove `<h1>` name; filter hidden fields |
| `apps/web/src/pages/FormEditorPage.tsx` | **MODIFY** — remove hardcoded CRM keys; fetch dynamic properties; add isVisible checkbox to field panel; update preview to respect visibility |

---

### Task 1: DB migration — add `is_visible` to `form_fields`

**Files:**
- Create: `packages/db/migrations/0008_form_field_visible.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Create the migration SQL file**

```sql
-- packages/db/migrations/0008_form_field_visible.sql
ALTER TABLE form_fields ADD COLUMN is_visible BOOLEAN NOT NULL DEFAULT TRUE;
```

- [ ] **Step 2: Register the migration in the journal**

Open `packages/db/migrations/meta/_journal.json` and add the new entry at the end of the `entries` array (keep `idx` sequential, `when` one more than the previous):

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 0, "tag": "0001_initial",                "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1, "tag": "0002_audit_logs",             "breakpoints": true },
    { "idx": 2, "version": "7", "when": 2, "tag": "0003_notes_tasks",            "breakpoints": true },
    { "idx": 3, "version": "7", "when": 3, "tag": "0004_deal_external_id",       "breakpoints": true },
    { "idx": 4, "version": "7", "when": 4, "tag": "0005_seed",                   "breakpoints": true },
    { "idx": 5, "version": "7", "when": 5, "tag": "0006_pipeline_default_view",  "breakpoints": true },
    { "idx": 6, "version": "7", "when": 6, "tag": "0007_forms",                  "breakpoints": true },
    { "idx": 7, "version": "7", "when": 7, "tag": "0008_form_field_visible",     "breakpoints": true }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/0008_form_field_visible.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): add is_visible column to form_fields

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Update Drizzle schema

**Files:**
- Modify: `packages/db/src/schema/forms.ts`

- [ ] **Step 1: Add `isVisible` field to `formFields` table definition**

In `packages/db/src/schema/forms.ts`, the `formFields` table definition currently ends at `crmPropertyKey`. Add `isVisible` after `crmPropertyKey` (line 67):

```typescript
// Replace this block (lines 55-74):
export const formFields = pgTable(
  'form_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: formFieldTypeEnum('type').notNull().default('text'),
    placeholder: text('placeholder'),
    isRequired: boolean('is_required').notNull().default(false),
    position: integer('position').notNull().default(0),
    options: jsonb('options').$type<Array<{ key: string; label: string }>>().default([]),
    crmPropertyKey: text('crm_property_key'),
    isVisible: boolean('is_visible').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    formIdIdx: index('form_fields_form_id_idx').on(t.formId),
    formKeyUniq: unique().on(t.formId, t.key),
  }),
);
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/schema/forms.ts
git commit -m "feat(db): add isVisible to formFields drizzle schema

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: Update API routes

**Files:**
- Modify: `apps/api/src/routes/forms.ts`

Three changes in this file:

**3a — Embed endpoint: filter hidden fields**

The embed endpoint (line 78–96) currently returns all fields. Filter to only `isVisible === true`:

- [ ] **Step 1: Update embed endpoint**

Replace the embed handler body (lines 79–96):

```typescript
  app.get('/api/forms/:id/embed', async (req, reply) => {
    const { id } = req.params as { id: string };

    const [form] = await app.db
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.status, 'active')))
      .limit(1);
    if (!form) return reply.code(404).send({ error: 'not_found' });

    const fields = await app.db
      .select()
      .from(formFields)
      .where(and(eq(formFields.formId, id), eq(formFields.isVisible, true)))
      .orderBy(formFields.position);

    return { ...form, fields };
  });
```

**3b — Update route: accept `isVisible` in field body**

The `PUT /api/forms/:id` route (lines 124–187) inserts fields without `isVisible`. Update the body type and the insert values:

- [ ] **Step 2: Update the PUT route body type and field insert**

Replace lines 132–141 (the `fields` array type in the body) and lines 165–175 (the insert values):

```typescript
// Body type — add isVisible to the fields array items:
      fields?: Array<{
        key: string;
        label: string;
        type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
        placeholder?: string;
        isRequired?: boolean;
        position?: number;
        options?: Array<{ key: string; label: string }>;
        crmPropertyKey?: string;
        isVisible?: boolean;
      }>;
```

```typescript
// Insert values — add isVisible:
          body.fields.map((f, idx) => ({
            formId: id,
            key: f.key,
            label: f.label,
            type: f.type,
            placeholder: f.placeholder ?? null,
            isRequired: f.isRequired ?? false,
            position: f.position ?? idx,
            options: f.options ?? [],
            crmPropertyKey: f.crmPropertyKey ?? null,
            isVisible: f.isVisible ?? true,
          })),
```

**3c — Submit route: skip required validation for hidden fields**

The submit route (lines 231–236) validates required fields without checking visibility. A hidden field can never be filled by the user, so required validation must be skipped for it:

- [ ] **Step 3: Update required-field validation in submit route**

Replace lines 231–236:

```typescript
    // Validate required fields (skip hidden fields — user cannot fill them)
    for (const field of fields) {
      if (field.isRequired && field.isVisible && !body[field.key]?.trim()) {
        return reply.code(400).send({ error: 'required_field_missing', field: field.key });
      }
    }
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/forms.ts
git commit -m "feat(api): support isVisible on form fields — filter embed, accept in update, skip required check

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Update `FormEmbedPage.tsx` — remove name header

**Files:**
- Modify: `apps/web/src/pages/FormEmbedPage.tsx`

The public form renders `form.name` as an `<h1>` at line 139. Remove it. The description (`<p>`) should remain.

- [ ] **Step 1: Remove the `<h1>` name element**

In `apps/web/src/pages/FormEmbedPage.tsx`, replace lines 136–142:

```tsx
  return (
    <div style={containerStyle}>
      <form onSubmit={handleSubmit} noValidate>
        {form.description && (
          <p style={{ margin: '0 0 24px', color: '#666', fontSize: 14 }}>{form.description}</p>
        )}
```

(Delete the `<h1>` line entirely; keep description `<p>` and everything after it unchanged.)

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/FormEmbedPage.tsx
git commit -m "feat(forms): hide form name from public embed view

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Update `FormEditorPage.tsx` — all three improvements

**Files:**
- Modify: `apps/web/src/pages/FormEditorPage.tsx`

This task handles: (a) remove name from preview, (b) add `isVisible` to the field interface and editor UI, (c) replace hardcoded CRM keys with a dynamic fetch.

**5a — Remove name from editor preview**

- [ ] **Step 1: Remove `<h2>` in `FormPreview` (line 509)**

In the `FormPreview` function (line 506), replace:

```tsx
function FormPreview({ form }: { form: FormData }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 28 }}>
      {form.description && <p style={{ margin: '0 0 24px', color: '#666', fontSize: 14 }}>{form.description}</p>}
      {form.fields.filter((f) => f.isVisible).map((field, idx) => (
```

(Remove the `<h2>` that renders `{form.name}` at the top of the preview; keep description `<p>`; also filter hidden fields in preview as shown.)

**5b — Add `isVisible` to `FormField` interface and wiring**

- [ ] **Step 2: Add `isVisible` to the `FormField` interface (line 13–23)**

```typescript
interface FormField {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  placeholder: string;
  isRequired: boolean;
  isVisible: boolean;
  position: number;
  options: FieldOption[];
  crmPropertyKey: string;
}
```

- [ ] **Step 3: Add `isVisible: true` default to `newField` factory (line 62–73)**

```typescript
function newField(position: number): FormField {
  return {
    key: `camp_${position + 1}`,
    label: '',
    type: 'text',
    placeholder: '',
    isRequired: false,
    isVisible: true,
    position,
    options: [],
    crmPropertyKey: '',
  };
}
```

- [ ] **Step 4: Normalise `isVisible` when loading form data (lines 96–101)**

In the `useEffect` that loads the form (`api.get`), update the field mapping:

```typescript
        fields: (data.fields ?? []).map((f: any) => ({
          ...f,
          placeholder: f.placeholder ?? '',
          options: f.options ?? [],
          crmPropertyKey: f.crmPropertyKey ?? '',
          isVisible: f.isVisible ?? true,
        })),
```

Do the same in the `save` callback where form state is set after `api.put` (around line 121–128):

```typescript
        fields: (updated.fields ?? []).map((fl: any) => ({
          ...fl,
          placeholder: fl.placeholder ?? '',
          options: fl.options ?? [],
          crmPropertyKey: fl.crmPropertyKey ?? '',
          isVisible: fl.isVisible ?? true,
        })),
```

**5c — Replace hardcoded CRM keys with dynamic fetch**

- [ ] **Step 5: Remove `CRM_PROPERTY_KEYS` constant and add state + useEffect**

Delete lines 44–50 (the `CRM_PROPERTY_KEYS` constant):

```typescript
// DELETE these lines:
const CRM_PROPERTY_KEYS = [
  { key: '', label: '— No mapejat —' },
  { key: 'email', label: 'Email (contacte)' },
  { key: 'phone', label: 'Telèfon (contacte)' },
  { key: 'first_name', label: 'Nom' },
  { key: 'last_name', label: 'Cognom' },
];
```

Inside `FormEditorPage` (the main component function), add state and a fetch after the existing state declarations (after line 87 `const [tab, setTab]`):

```typescript
  const [crmProperties, setCrmProperties] = useState<Array<{ key: string; label: string }>>([]);

  useEffect(() => {
    api.get('/api/properties?scope=contact')
      .then((data: Array<{ key: string; label: string }>) => {
        setCrmProperties([{ key: '', label: '— No mapejat —' }, ...data.map((p) => ({ key: p.key, label: p.label }))]);
      })
      .catch(() => {/* silently ignore — mapping dropdown will be empty */});
  }, []);
```

- [ ] **Step 6: Pass `crmProperties` into `FieldPropertiesPanel`**

Update the `FieldPropertiesPanel` call site (around line 292–297) to pass `crmProperties` and `isVisible`:

```tsx
              <FieldPropertiesPanel
                field={form.fields[selectedFieldIdx]!}
                isAdmin={isAdmin}
                crmProperties={crmProperties}
                onChange={(changes) => updateField(selectedFieldIdx, changes)}
              />
```

- [ ] **Step 7: Update `FieldPropertiesPanel` props type, add visibility checkbox, use dynamic CRM list**

Replace the entire `FieldPropertiesPanel` function (lines 369–467):

```tsx
function FieldPropertiesPanel({ field, isAdmin, crmProperties, onChange }: {
  field: FormField;
  isAdmin: boolean;
  crmProperties: Array<{ key: string; label: string }>;
  onChange: (changes: Partial<FormField>) => void;
}) {
  function handleLabelChange(label: string) {
    const autoKey = makeKey(label);
    onChange({ label, key: autoKey });
  }

  return (
    <div style={{ maxWidth: 460 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 20, color: '#333' }}>Propietats del camp</div>

      <Label>Etiqueta *</Label>
      <input
        value={field.label}
        disabled={!isAdmin}
        onChange={(e) => handleLabelChange(e.target.value)}
        style={{ ...inputStyle, width: '100%' }}
        placeholder="Ex: El teu nom"
      />

      <Label>Clau interna</Label>
      <input
        value={field.key}
        disabled={!isAdmin}
        onChange={(e) => onChange({ key: e.target.value })}
        style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        placeholder="nom_camp"
      />

      <Label>Tipus de camp</Label>
      <select
        value={field.type}
        disabled={!isAdmin}
        onChange={(e) => onChange({ type: e.target.value as FieldType })}
        style={{ ...inputStyle, width: '100%' }}
      >
        {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
          <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
        ))}
      </select>

      {(field.type !== 'checkbox') && (
        <>
          <Label>Placeholder</Label>
          <input
            value={field.placeholder}
            disabled={!isAdmin}
            onChange={(e) => onChange({ placeholder: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
            placeholder="Text d'ajuda"
          />
        </>
      )}

      {field.type === 'select' && (
        <SelectOptionsEditor
          options={field.options}
          isAdmin={isAdmin}
          onChange={(options) => onChange({ options })}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <input
          type="checkbox"
          id="required"
          checked={field.isRequired}
          disabled={!isAdmin}
          onChange={(e) => onChange({ isRequired: e.target.checked })}
          style={{ width: 16, height: 16, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
        />
        <label htmlFor="required" style={{ fontSize: 13, color: '#444', cursor: isAdmin ? 'pointer' : 'default' }}>
          Camp obligatori
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <input
          type="checkbox"
          id="visible"
          checked={field.isVisible}
          disabled={!isAdmin}
          onChange={(e) => onChange({ isVisible: e.target.checked })}
          style={{ width: 16, height: 16, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
        />
        <label htmlFor="visible" style={{ fontSize: 13, color: '#444', cursor: isAdmin ? 'pointer' : 'default' }}>
          Visible per al client
        </label>
      </div>

      <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
        <Label>Mapatge CRM</Label>
        <select
          value={field.crmPropertyKey}
          disabled={!isAdmin}
          onChange={(e) => onChange({ crmPropertyKey: e.target.value })}
          style={{ ...inputStyle, width: '100%' }}
        >
          {crmProperties.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          Vincular el valor d'aquest camp a un atribut del contacte al CRM.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/FormEditorPage.tsx
git commit -m "feat(forms): isVisible toggle per field, dynamic CRM mapping, hide name from preview

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Manual verification checklist

Run the dev server and verify all three features work end-to-end.

- [ ] **Step 1: Start dev environment**

```bash
# From repo root
pnpm dev
```

- [ ] **Step 2: Verify — form name hidden in embed**

1. Open any active form in `/crm/forms/embed/<id>`
2. Confirm: no form name/title appears at the top
3. Confirm: description still appears if set

- [ ] **Step 3: Verify — visibility toggle**

1. Open a form in the editor `/crm/forms/<id>/edit`
2. Select a field → confirm "Visible per al client" checkbox appears, checked by default
3. Uncheck it → Save
4. Open the embed URL → confirm the hidden field does NOT appear
5. Try submitting the form → confirm it submits successfully (no "required field" error for the now-hidden field even if it was marked required)

- [ ] **Step 4: Verify — editor preview respects visibility**

1. In the editor, switch to "Previsualització" tab
2. Hidden fields should not appear in the preview either

- [ ] **Step 5: Verify — CRM mapping shows all properties**

1. Open a form in the editor
2. Select a field → scroll to "Mapatge CRM"
3. Confirm the dropdown shows all contact properties from the DB (not just 4)

- [ ] **Step 6: Verify — form name hidden in editor preview**

1. In the editor "Previsualització" tab
2. Confirm the form name `<h2>` no longer appears at the top

---

## Spec Coverage Self-Check

| Requirement | Task |
|-------------|------|
| Form name must not appear in the published form | Task 4, Task 5 (5a) |
| Only editor-defined fields appear in the public form | Task 3 (3a), Task 4 |
| Fields have visible/hidden checkbox | Task 1, Task 2, Task 3, Task 5 (5b) |
| Hidden fields not shown to client | Task 3 (3a), Task 4, Task 5 (5a) |
| CRM mapping shows all contact options | Task 5 (5c) |
