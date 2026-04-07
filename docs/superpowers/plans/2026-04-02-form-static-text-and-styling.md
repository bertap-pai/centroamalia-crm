# Form Static Text Field + Styling (CEN-121 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `static_text` field type to forms so admins can embed explanatory text blocks; support basic styling (preset size + color) on those blocks.

**Architecture:** New `static_text` enum value added via ALTER TYPE migration. Styling stored in the existing `options` JSONB field using reserved keys `{key: 'preset', label: 'normal|heading|caption'}` and `{key: 'color', label: '#rrggbb'}` — no new columns needed. Editor shows a preset selector and a color input instead of the CRM/required controls for this type. Embed renders the block as `<p>`, `<h2>`, or `<small>` with inline color style.

**Tech Stack:** PostgreSQL (enum migration), Drizzle ORM, Fastify, React + TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/db/migrations/0011_form_static_text.sql` | **CREATE** — ALTER TYPE migration |
| `packages/db/migrations/meta/_journal.json` | **MODIFY** — add entry for 0011 |
| `packages/db/src/schema/forms.ts` | **MODIFY** — add `static_text` to enum |
| `apps/api/src/routes/forms.ts` | **MODIFY** — accept `static_text` in body type of PUT route |
| `apps/web/src/pages/FormEmbedPage.tsx` | **MODIFY** — render `static_text` fields as styled text blocks |
| `apps/web/src/pages/FormEditorPage.tsx` | **MODIFY** — add `static_text` to type labels; custom panel for it in FieldPropertiesPanel |

---

### Task 1: DB migration — add `static_text` to form_field_type enum

**Files:**
- Create: `packages/db/migrations/0011_form_static_text.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

> **Note:** Check the current highest migration index in `_journal.json` before writing the index number. As of writing the latest entry was `0010_property_group` at idx 9. Use idx 10 for this migration.

- [ ] **Step 1: Create the migration SQL**

```sql
-- packages/db/migrations/0011_form_static_text.sql
ALTER TYPE form_field_type ADD VALUE IF NOT EXISTS 'static_text';
```

- [ ] **Step 2: Add journal entry**

Open `packages/db/migrations/meta/_journal.json`. Add at the end of the `entries` array:

```json
{ "idx": 10, "version": "7", "when": 10, "tag": "0011_form_static_text", "breakpoints": true }
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/0011_form_static_text.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): add static_text to form_field_type enum

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Update Drizzle schema enum

**Files:**
- Modify: `packages/db/src/schema/forms.ts`

- [ ] **Step 1: Add `static_text` to the enum definition**

In `packages/db/src/schema/forms.ts`, replace:

```typescript
export const formFieldTypeEnum = pgEnum('form_field_type', [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
  'checkbox',
]);
```

with:

```typescript
export const formFieldTypeEnum = pgEnum('form_field_type', [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
  'checkbox',
  'static_text',
]);
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/schema/forms.ts
git commit -m "feat(db): add static_text to formFieldTypeEnum drizzle schema

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: Update API PUT route to accept `static_text`

**Files:**
- Modify: `apps/api/src/routes/forms.ts`

The `PUT /api/forms/:id` route has a TypeScript body type with a `type` union. Add `'static_text'`:

- [ ] **Step 1: Update body type**

Find the field type union in the body type (currently `'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox'`) and add `'static_text'`:

```typescript
        type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'static_text';
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/forms.ts
git commit -m "feat(api): accept static_text field type in form update route

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Render `static_text` in `FormEmbedPage.tsx`

**Files:**
- Modify: `apps/web/src/pages/FormEmbedPage.tsx`

**Styling logic for static_text:**
- Read `options` to find `{key: 'preset'}` → value is `'normal'` (default), `'heading'`, or `'caption'`
- Read `options` to find `{key: 'color'}` → CSS color string, default `'#333'`
- `heading` → render as `<h2>` style (fontSize 20, fontWeight 700)
- `normal` → render as `<p>` style (fontSize 14)
- `caption` → render as `<p>` style (fontSize 12, color muted to 70% opacity)

- [ ] **Step 1: Update `FormField` interface to broaden the type**

In `FormEmbedPage.tsx`, the `FormField` interface has `type: FieldType`. Update `FieldType` to include `static_text`:

```typescript
type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'static_text';
```

- [ ] **Step 2: Add a helper to extract option by key**

Add this helper above the component:

```typescript
function getOption(options: Array<{ key: string; label: string }>, key: string, fallback: string): string {
  return options.find((o) => o.key === key)?.label ?? fallback;
}
```

- [ ] **Step 3: Add static_text rendering in the fields map**

In the `form.fields.map(...)` section (currently renders textarea / select / checkbox / input), add a branch for `static_text` at the top of the conditional chain:

```tsx
        {field.type === 'static_text' ? (() => {
          const preset = getOption(field.options, 'preset', 'normal');
          const color = getOption(field.options, 'color', '#333');
          if (preset === 'heading') {
            return (
              <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color }}>{field.label}</h2>
            );
          }
          if (preset === 'caption') {
            return (
              <p style={{ margin: '0 0 4px', fontSize: 12, color, opacity: 0.75 }}>{field.label}</p>
            );
          }
          return (
            <p style={{ margin: '0 0 4px', fontSize: 14, color }}>{field.label}</p>
          );
        })() : field.type === 'textarea' ? (
```

> Note: wrap the existing chain — `static_text` branch returns early from the IIFE without any label/required indicator above it.

- [ ] **Step 4: Skip label + required asterisk for `static_text`**

The current render wraps every field in a `<div>` with a `<label>` showing `field.label` and required asterisk. For `static_text` fields we skip the label wrapper. Update the map:

```tsx
        {form.fields.map((field) => (
          <div key={field.key} style={{ marginBottom: 18 }}>
            {field.type !== 'static_text' && (
              <label style={{ display: 'block', fontWeight: 500, fontSize: 13, color: '#333', marginBottom: 5 }}>
                {field.label}
                {field.isRequired && <span style={{ color: '#e87d52', marginLeft: 3 }}>*</span>}
              </label>
            )}
            {/* ... field type rendering ... */}
          </div>
        ))}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/FormEmbedPage.tsx
git commit -m "feat(forms): render static_text field type in embed view

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Update `FormEditorPage.tsx` — static_text support

**Files:**
- Modify: `apps/web/src/pages/FormEditorPage.tsx`

- [ ] **Step 1: Update `FieldType` and `FIELD_TYPE_LABELS`**

Add `static_text` to the `FieldType` union and labels map:

```typescript
type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'static_text';
```

```typescript
const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text curt',
  email: 'Email',
  phone: 'Telèfon',
  textarea: 'Text llarg',
  select: 'Desplegable',
  checkbox: 'Casella',
  static_text: 'Text estàtic',
};
```

- [ ] **Step 2: Add helper `getOption` (same as embed)**

```typescript
function getOption(options: FieldOption[], key: string, fallback: string): string {
  return options.find((o) => o.key === key)?.label ?? fallback;
}
```

- [ ] **Step 3: Update `FieldPropertiesPanel` to show custom controls for `static_text`**

Inside `FieldPropertiesPanel`, after the existing controls, add a block that replaces the required / visible / CRM section when field type is `static_text`. Replace the `isRequired`, `isVisible`, and CRM `select` section with a conditional:

```tsx
      {field.type === 'static_text' ? (
        <div style={{ marginTop: 16 }}>
          <Label>Mida del text</Label>
          <select
            value={getOption(field.options, 'preset', 'normal')}
            disabled={!isAdmin}
            onChange={(e) => {
              const updated = field.options.filter((o) => o.key !== 'preset');
              onChange({ options: [...updated, { key: 'preset', label: e.target.value }] });
            }}
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="normal">Normal</option>
            <option value="heading">Títol (gran)</option>
            <option value="caption">Subtítol (petit)</option>
          </select>

          <Label>Color del text</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={getOption(field.options, 'color', '#333333')}
              disabled={!isAdmin}
              onChange={(e) => {
                const updated = field.options.filter((o) => o.key !== 'color');
                onChange({ options: [...updated, { key: 'color', label: e.target.value }] });
              }}
              style={{ width: 40, height: 32, padding: 2, border: '1px solid var(--color-border)', borderRadius: 4, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
            />
            <span style={{ fontSize: 12, color: '#888' }}>{getOption(field.options, 'color', '#333333')}</span>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}
```

> Note: The above replaces the existing required/visible/CRM section entirely with a conditional. For `static_text` we show preset + color; for everything else we show the existing required/visible/CRM controls.

- [ ] **Step 4: Update `FormPreview` to render `static_text` fields**

In the `FormPreview` function, add a branch for `static_text` in the field rendering (alongside the existing textarea/select/checkbox/input branches):

```tsx
        {field.type === 'static_text' ? (() => {
          const preset = getOption(field.options, 'preset', 'normal');
          const color = getOption(field.options, 'color', '#333');
          if (preset === 'heading') return <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color }}>{field.label}</h2>;
          if (preset === 'caption') return <p style={{ margin: '0 0 4px', fontSize: 12, color, opacity: 0.75 }}>{field.label}</p>;
          return <p style={{ margin: '0 0 4px', fontSize: 14, color }}>{field.label}</p>;
        })() : field.type === 'textarea' ? (
```

Also skip the `<label>` for `static_text` in the preview (same as embed):

```tsx
          {field.type !== 'static_text' && (
            <label style={{ display: 'block', fontWeight: 500, fontSize: 13, color: '#333', marginBottom: 6 }}>
              {field.label || `Camp ${idx + 1}`}
              {field.isRequired && <span style={{ color: 'var(--color-primary)', marginLeft: 3 }}>*</span>}
            </label>
          )}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/FormEditorPage.tsx
git commit -m "feat(forms): add static_text field type with preset size and color styling

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start dev environment**

```bash
pnpm dev
```

- [ ] **Step 2: Verify static text in editor**

1. Open a form in `/crm/forms/<id>/edit`
2. Add a new field → change type to "Text estàtic"
3. Enter text in the label field
4. Change preset to "Títol (gran)" → confirm preview updates in the Previsualització tab
5. Change color using the color picker → confirm preview updates
6. Save → reload and confirm settings persist

- [ ] **Step 3: Verify static text in embed**

1. Set the form to active
2. Open the embed URL `/crm/forms/embed/<id>`
3. Confirm static text blocks render at the correct size and color
4. Confirm no label/required asterisk appears above static text
5. Submit the form — confirm it submits successfully (static_text field not in payload validation)

- [ ] **Step 4: Verify required validation skips static_text**

In `apps/api/src/routes/forms.ts`, the required-field validation loop already skips hidden fields. Confirm `static_text` fields also cannot block submission — since `static_text` fields should never be marked `isRequired`, this should be fine by design. If needed, add `&& field.type !== 'static_text'` to the validation condition.

---

## Spec Coverage

| Requirement | Task |
|-------------|------|
| Field to write explanatory text (not linked to CRM) | Tasks 1–5 (`static_text` type) |
| Change colors of text | Task 5 (color picker) |
| Change font size of text | Task 5 (preset selector: normal/heading/caption) |
| Responsiveness (see comment — already satisfied) | N/A — current embed is fluid/responsive by design |
