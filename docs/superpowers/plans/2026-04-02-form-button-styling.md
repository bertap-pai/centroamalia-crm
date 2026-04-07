# Form Button Styling (CEN-121 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Button" section to the form editor's general settings panel so admins can customise the submit button's background colour, text colour, border radius, and font size. Changes persist to the DB and are reflected in the public embed.

**Architecture:** A new `button_style` JSONB column on the `forms` table stores `{ background, color, borderRadius, fontSize }` with sensible defaults. The API PUT route already accepts arbitrary metadata fields — add `buttonStyle` to the accepted body. The embed endpoint returns the full form row (including the new column) via `{ ...form, fields }` so no embed route change is needed. The editor gains a button-style sub-section inside "Configuració general" with colour pickers and numeric inputs, plus a live preview of the button.

**Tech Stack:** PostgreSQL, Drizzle ORM, Fastify, React + TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/db/migrations/0012_form_button_style.sql` | **CREATE** — ALTER TABLE to add `button_style` column |
| `packages/db/migrations/meta/_journal.json` | **MODIFY** — add entry idx 11 |
| `packages/db/src/schema/forms.ts` | **MODIFY** — add `buttonStyle` JSONB field to `forms` table |
| `apps/api/src/routes/forms.ts` | **MODIFY** — accept and persist `buttonStyle` in PUT route |
| `apps/web/src/pages/FormEditorPage.tsx` | **MODIFY** — add `buttonStyle` to `FormData` interface, general settings panel, and button preview |
| `apps/web/src/pages/FormEmbedPage.tsx` | **MODIFY** — apply `buttonStyle` to submit button; add `buttonStyle` to `FormData` interface |

---

### Task 1: DB migration

**Files:**
- Create: `packages/db/migrations/0012_form_button_style.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Create the migration SQL**

```sql
-- packages/db/migrations/0012_form_button_style.sql
ALTER TABLE forms ADD COLUMN button_style JSONB NOT NULL DEFAULT '{"background":"#e87d52","color":"#ffffff","borderRadius":6,"fontSize":14}';
```

- [ ] **Step 2: Add journal entry**

Open `packages/db/migrations/meta/_journal.json`. The current last entry is idx 10 (`0011_form_static_text`). Add at the end of `entries`:

```json
{ "idx": 11, "version": "7", "when": 11, "tag": "0012_form_button_style", "breakpoints": true }
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/0012_form_button_style.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): add button_style column to forms table

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Update Drizzle schema

**Files:**
- Modify: `packages/db/src/schema/forms.ts`

- [ ] **Step 1: Add `buttonStyle` field to the `forms` table definition**

The `forms` table currently ends with `archivedAt`. Add `buttonStyle` after `successMessage` (before `createdByUserId`):

```typescript
// In the forms table definition, add after successMessage:
    buttonStyle: jsonb('button_style')
      .$type<{ background: string; color: string; borderRadius: number; fontSize: number }>()
      .notNull()
      .default({ background: '#e87d52', color: '#ffffff', borderRadius: 6, fontSize: 14 }),
```

The full updated `forms` table (replace the existing definition):

```typescript
export const forms = pgTable(
  'forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: formStatusEnum('status').notNull().default('draft'),
    submitLabel: text('submit_label').notNull().default('Enviar'),
    successMessage: text('success_message').notNull().default('Gràcies! Hem rebut el teu missatge.'),
    buttonStyle: jsonb('button_style')
      .$type<{ background: string; color: string; borderRadius: number; fontSize: number }>()
      .notNull()
      .default({ background: '#e87d52', color: '#ffffff', borderRadius: 6, fontSize: 14 }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('forms_status_idx').on(t.status),
    archivedIdx: index('forms_archived_at_idx').on(t.archivedAt),
  }),
);
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/schema/forms.ts
git commit -m "feat(db): add buttonStyle to forms drizzle schema

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: Update API PUT route

**Files:**
- Modify: `apps/api/src/routes/forms.ts`

The `PUT /api/forms/:id` route accepts `name`, `description`, `status`, `submitLabel`, `successMessage`. Add `buttonStyle`.

- [ ] **Step 1: Add `buttonStyle` to the body type**

In the PUT route body type (after `successMessage?`):

```typescript
      buttonStyle?: {
        background?: string;
        color?: string;
        borderRadius?: number;
        fontSize?: number;
      };
```

- [ ] **Step 2: Persist `buttonStyle` in the updates object**

After the existing `if (body.successMessage !== undefined)` line, add:

```typescript
    if (body.buttonStyle !== undefined) {
      const existing_bs = existing.buttonStyle as { background: string; color: string; borderRadius: number; fontSize: number };
      updates['buttonStyle'] = { ...existing_bs, ...body.buttonStyle };
    }
```

> This merges partial updates so the client only needs to send changed fields.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/forms.ts
git commit -m "feat(api): accept buttonStyle in form update route

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Update `FormEmbedPage.tsx`

**Files:**
- Modify: `apps/web/src/pages/FormEmbedPage.tsx`

- [ ] **Step 1: Add `buttonStyle` to the `FormData` interface**

```typescript
interface FormData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  submitLabel: string;
  successMessage: string;
  buttonStyle: {
    background: string;
    color: string;
    borderRadius: number;
    fontSize: number;
  };
  fields: FormField[];
}
```

- [ ] **Step 2: Apply `buttonStyle` to the submit button**

Replace the hardcoded button style (lines 229–241) with dynamic values from `form.buttonStyle`:

```tsx
        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 8,
            background: form.buttonStyle?.background ?? '#e87d52',
            color: form.buttonStyle?.color ?? '#fff',
            border: 'none',
            borderRadius: form.buttonStyle?.borderRadius ?? 6,
            padding: '11px 24px',
            fontSize: form.buttonStyle?.fontSize ?? 14,
            fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            width: '100%',
          }}
        >
          {submitting ? 'Enviant...' : form.submitLabel}
        </button>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/FormEmbedPage.tsx
git commit -m "feat(forms): apply buttonStyle from form data to submit button in embed

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Update `FormEditorPage.tsx`

**Files:**
- Modify: `apps/web/src/pages/FormEditorPage.tsx`

- [ ] **Step 1: Add `buttonStyle` to the `FormData` interface**

```typescript
interface FormData {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  submitLabel: string;
  successMessage: string;
  buttonStyle: {
    background: string;
    color: string;
    borderRadius: number;
    fontSize: number;
  };
  fields: FormField[];
}
```

- [ ] **Step 2: Normalise `buttonStyle` when loading form data**

In the `useEffect` that calls `api.get('/api/forms/${id}')`, add normalisation after `successMessage`:

```typescript
        setForm({
          ...data,
          description: data.description ?? '',
          buttonStyle: data.buttonStyle ?? { background: '#e87d52', color: '#ffffff', borderRadius: 6, fontSize: 14 },
          fields: (data.fields ?? []).map((f: any) => ({
            ...f,
            placeholder: f.placeholder ?? '',
            options: f.options ?? [],
            crmPropertyKey: f.crmPropertyKey ?? '',
            isVisible: f.isVisible ?? true,
          })),
        });
```

Do the same inside the `save` callback where `setForm` is called with `updated`.

- [ ] **Step 3: Include `buttonStyle` in the save payload**

In the `save` callback, in the `api.put` call, add `buttonStyle: f.buttonStyle` alongside the other fields:

```typescript
      const updated = await api.put(`/api/forms/${f.id}`, {
        name: f.name,
        description: f.description || null,
        status: f.status,
        submitLabel: f.submitLabel,
        successMessage: f.successMessage,
        buttonStyle: f.buttonStyle,
        fields: f.fields.map((field, idx) => ({ ...field, position: idx })),
      });
```

- [ ] **Step 4: Add button styling section to the general settings panel**

In the "Configuració general" panel (the block rendered when `selectedFieldIdx === null`), add a new section after the `successMessage` textarea. Insert this block:

```tsx
                    <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16, color: '#333' }}>Botó d'enviament</div>

                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                        <div>
                          <Label>Color de fons</Label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="color"
                              value={form.buttonStyle.background}
                              disabled={!isAdmin}
                              onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, background: e.target.value } })}
                              style={{ width: 40, height: 32, padding: 2, border: '1px solid var(--color-border)', borderRadius: 4, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                            />
                            <span style={{ fontSize: 12, color: '#888' }}>{form.buttonStyle.background}</span>
                          </div>
                        </div>

                        <div>
                          <Label>Color del text</Label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="color"
                              value={form.buttonStyle.color}
                              disabled={!isAdmin}
                              onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, color: e.target.value } })}
                              style={{ width: 40, height: 32, padding: 2, border: '1px solid var(--color-border)', borderRadius: 4, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                            />
                            <span style={{ fontSize: 12, color: '#888' }}>{form.buttonStyle.color}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                        <div>
                          <Label>Arrodoniment (px)</Label>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            value={form.buttonStyle.borderRadius}
                            disabled={!isAdmin}
                            onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, borderRadius: Number(e.target.value) } })}
                            style={{ ...inputStyle, width: 80 }}
                          />
                        </div>

                        <div>
                          <Label>Mida de lletra (px)</Label>
                          <input
                            type="number"
                            min={10}
                            max={24}
                            value={form.buttonStyle.fontSize}
                            disabled={!isAdmin}
                            onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, fontSize: Number(e.target.value) } })}
                            style={{ ...inputStyle, width: 80 }}
                          />
                        </div>
                      </div>

                      {/* Live preview */}
                      <Label>Previsualització</Label>
                      <button
                        disabled
                        style={{
                          background: form.buttonStyle.background,
                          color: form.buttonStyle.color,
                          border: 'none',
                          borderRadius: form.buttonStyle.borderRadius,
                          padding: '11px 24px',
                          fontSize: form.buttonStyle.fontSize,
                          fontWeight: 600,
                          cursor: 'not-allowed',
                          opacity: 0.9,
                        }}
                      >
                        {form.submitLabel || 'Enviar'}
                      </button>
                    </div>
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/FormEditorPage.tsx
git commit -m "feat(forms): add button styling section to form editor general settings

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start dev environment**

```bash
pnpm dev
```

- [ ] **Step 2: Verify editor — button styling section**

1. Open a form in `/crm/forms/<id>/edit`
2. Click away from all fields (deselect) to see the general settings panel
3. Scroll to the "Botó d'enviament" section
4. Change background color — confirm the live preview button updates in real time
5. Change text color, border radius, font size — confirm preview updates
6. Save → reload → confirm settings persisted

- [ ] **Step 3: Verify embed — button styles applied**

1. Set form to active
2. Open embed URL `/crm/forms/embed/<id>`
3. Confirm the submit button renders with the custom colors/size/radius

- [ ] **Step 4: Verify defaults on existing forms**

1. Open a form that was created before this migration
2. Confirm the button styling section shows the default values (`#e87d52` bg, `#ffffff` text, radius 6, size 14)
3. Confirm the embed still renders the button correctly with defaults
