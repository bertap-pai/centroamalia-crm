# CRM Miscellaneous Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five independent UI improvements to the CRM: (1) replace the stage-transition validation error banner with a fill-in modal, (2) add filter bar and save-view support to the Kanban view, (3) change the property group assignment field from a text input to a dropdown, (4) add a group management UI, (5) add drag-to-reorder columns and sortable column headers to the contacts list.

**Architecture:** All changes are in existing files. Tasks 1–4 touch `apps/web/src/pages/DealsListPage.tsx`, `apps/web/src/pages/AdminPropertiesPage.tsx`, `apps/api/src/routes/deals.ts`, and `apps/api/src/routes/properties.ts`. Task 5 touches only `apps/web/src/pages/ContactsListPage.tsx` (the contacts API already supports `sort`/`sortDir` params). No new files are created. No database migrations needed.

**Tech Stack:** React (no testing framework present), Fastify + Drizzle ORM (Node.js API), TypeScript, pnpm monorepo.

---

## Scope note

These four features are independent. If one is blocked, skip it and do the others. Commit after each task.

---

## Task 1: Stage Transition Fill-In Modal

When a deal is dragged to a stage that has required fields not yet filled, replace the yellow warning banner with a modal that lets the user fill in the missing fields before confirming the move.

**Files:**
- Modify: `apps/web/src/pages/DealsListPage.tsx`

### Context

- `handleDrop` (line 242) currently catches `validation_failed` and calls `setValidationError(...)`.
- `validationError` state (line 139) is `{ dealId: string; missingFields: string[] } | null`.
- The banner lives at lines 701–718.
- `propertyDefs` (already in scope, loaded at startup) contains all deal property definitions with `type` and `options`.
- `users` state contains `{ id, name }[]` and is already loaded.
- `PATCH /api/deals/:id` accepts `{ ownerUserId?, properties?: Record<string, string> }`.
- `POST /api/deals/:id/stage` accepts `{ stageId }`.
- The special field `owner_user_id` is NOT a property def — it maps to `deal.ownerUserId`.

- [ ] **Step 1: Replace `validationError` state with `stageTransitionModal` state**

In `DealsListPage` function, find line 139:
```typescript
const [validationError, setValidationError] = useState<{ dealId: string; missingFields: string[] } | null>(null);
```
Replace it with:
```typescript
const [stageTransitionModal, setStageTransitionModal] = useState<{
  dealId: string;
  targetStageId: string;
  missingFields: string[];
} | null>(null);
```

- [ ] **Step 2: Update `handleDragStart` to clear the modal**

Find line 234:
```typescript
setValidationError(null);
```
Replace with:
```typescript
setStageTransitionModal(null);
```

- [ ] **Step 3: Update `handleDrop` to open the modal instead of setting banner error**

Find lines 254–257:
```typescript
    } catch (err: any) {
      if (err.data?.error === 'validation_failed') {
        setValidationError({ dealId: draggingDealId, missingFields: err.data.missingFields });
      }
```
Replace with:
```typescript
    } catch (err: any) {
      if (err.data?.error === 'validation_failed') {
        setStageTransitionModal({
          dealId: draggingDealId,
          targetStageId,
          missingFields: err.data.missingFields,
        });
      }
```

- [ ] **Step 4: Remove the validation error banner JSX**

Find and delete lines 701–718 (the entire `{validationError && ...}` block):
```tsx
      {/* Validation error banner */}
      {validationError && (
        <div
          style={{
            background: '#fff3cd', border: '1px solid #f0b99e', padding: '10px 24px',
            fontSize: 13, color: '#856404', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span>⚠ No es pot moure el deal: camps obligatoris buits:</span>
          <strong>{validationError.missingFields.join(', ')}</strong>
          <button
            onClick={() => setValidationError(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#856404' }}
          >
            ×
          </button>
        </div>
      )}
```

- [ ] **Step 5: Wire the modal in JSX**

Just before the closing `</div>` of the main `DealsListPage` return (around line 778, before `{showCreate && ...}`), add:
```tsx
      {stageTransitionModal && (
        <StageFillModal
          dealId={stageTransitionModal.dealId}
          targetStageId={stageTransitionModal.targetStageId}
          missingFields={stageTransitionModal.missingFields}
          propertyDefs={dealPropDefs}
          users={users}
          onClose={() => setStageTransitionModal(null)}
          onSuccess={() => { setStageTransitionModal(null); refreshKanban(); }}
        />
      )}
```

- [ ] **Step 6: Add `StageFillModal` and `PropertyInput` components at the bottom of the file**

After the `formatPropValue` function (around line 1035), add these two new components:

```tsx
// ─── Stage Fill Modal ─────────────────────────────────────────────────────────

function StageFillModal({
  dealId,
  targetStageId,
  missingFields,
  propertyDefs,
  users,
  onClose,
  onSuccess,
}: {
  dealId: string;
  targetStageId: string;
  missingFields: string[];
  propertyDefs: PropertyDef[];
  users: UserOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  // Separate special fields from property defs
  const hasOwnerField = missingFields.includes('owner_user_id');
  const propKeys = missingFields.filter((k) => k !== 'owner_user_id');
  const relevantDefs = propKeys
    .map((key) => propertyDefs.find((d) => d.key === key))
    .filter((d): d is PropertyDef => Boolean(d));

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validate all fields are filled
    const unfilledLabels: string[] = [];
    if (hasOwnerField && !values['owner_user_id']) unfilledLabels.push('Responsable');
    for (const def of relevantDefs) {
      if (!values[def.key]) unfilledLabels.push(def.label);
    }
    if (unfilledLabels.length > 0) {
      setError(`Omple els camps obligatoris: ${unfilledLabels.join(', ')}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const patchBody: Record<string, any> = {};
      if (hasOwnerField) patchBody.ownerUserId = values['owner_user_id'];
      const propValues: Record<string, string> = {};
      for (const def of relevantDefs) propValues[def.key] = values[def.key] ?? '';
      if (Object.keys(propValues).length > 0) patchBody.properties = propValues;
      await api.patch(`/api/deals/${dealId}`, patchBody);
      await api.post(`/api/deals/${dealId}/stage`, { stageId: targetStageId });
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Error en guardar.');
    } finally {
      setSaving(false);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200,
  };
  const modalStyle: React.CSSProperties = {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    background: '#fff', borderRadius: 10, padding: 24, zIndex: 201,
    width: '90%', maxWidth: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    maxHeight: '90vh', overflowY: 'auto',
  };
  const fieldStyle: React.CSSProperties = { marginBottom: 14 };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4,
  };
  const inputCommon: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)',
    borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <>
      <div onClick={onClose} style={overlayStyle} />
      <div style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Camps obligatoris per canviar d&apos;etapa
          </h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#999' }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          Omple els camps següents per poder moure el deal a la nova etapa.
        </p>
        <form onSubmit={handleSubmit}>
          {hasOwnerField && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Responsable *</label>
              <select
                value={values['owner_user_id'] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, owner_user_id: e.target.value }))}
                style={inputCommon}
              >
                <option value="">Selecciona un responsable...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? u.id}</option>
                ))}
              </select>
            </div>
          )}
          {relevantDefs.map((def) => (
            <div key={def.key} style={fieldStyle}>
              <label style={labelStyle}>{def.label} *</label>
              <PropertyInput
                def={def}
                value={values[def.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [def.key]: v }))}
                inputStyle={inputCommon}
              />
            </div>
          ))}
          {error && (
            <div style={{ color: '#e74c3c', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#fff', color: '#555', border: '1px solid var(--color-border)',
                padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel·lar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: 'var(--color-primary)', color: '#fff', border: 'none',
                padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {saving ? 'Guardant...' : 'Guardar i moure'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function PropertyInput({
  def,
  value,
  onChange,
  inputStyle,
}: {
  def: PropertyDef;
  value: string;
  onChange: (v: string) => void;
  inputStyle: React.CSSProperties;
}) {
  if (def.type === 'select' || def.type === 'multiselect') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Selecciona...</option>
        {def.options?.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (def.type === 'boolean') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Selecciona...</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (def.type === 'date' || def.type === 'datetime') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    );
  }
  if (def.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={inputStyle}
      />
    );
  }
  return (
    <input
      type={def.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}
```

- [ ] **Step 7: Verify manually**

1. Start the dev server: `pnpm dev` from the repo root.
2. Open a deal pipeline in Kanban view.
3. In Admin → Pipelines, make sure one stage has a required field (e.g., `lead_source`).
4. Make sure that field is empty on a deal.
5. Drag the deal to the required stage.
6. Verify a modal appears with the field(s) to fill.
7. Fill the fields and click "Guardar i moure" — deal should move and kanban should refresh.
8. Drag the same deal again — it should move without showing the modal.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/DealsListPage.tsx
git commit -m "feat(web): show fill-in modal on required-field stage transition

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 2: Kanban Filter Bar + Save View

**Files:**
- Modify: `apps/api/src/routes/deals.ts`
- Modify: `apps/web/src/pages/DealsListPage.tsx`

### Context

- The kanban endpoint `GET /api/deals/kanban` (line 201 of `deals.ts`) currently only accepts `pipelineId` and `includeArchived`.
- The filter bar (lines 568–699 of `DealsListPage.tsx`) is only shown when `viewMode === 'list'` — the condition at line 425.
- The save view button (lines 482–529) is also gated to `viewMode === 'list'`.
- `refreshKanban` (line 224) does not pass filter params.
- The kanban useEffect (line 213) does not depend on filter state.
- `handleSaveView` (line 272) saves `{ columns, sort, sortDir, viewMode }` but no filters.
- `applyView` (line 263) does not restore filters.
- `SavedView.config.filters` is typed as `Record<string, string>` but never used.

### Part A: API — add filter support to kanban endpoint

- [ ] **Step 1: Add filter params to `GET /api/deals/kanban`**

In `apps/api/src/routes/deals.ts`, find the kanban handler (around line 205). After reading `includeArchived`:
```typescript
const includeArchived = q['includeArchived'] === 'true';
```
Add:
```typescript
const filterOwnerUserId = q['ownerUserId'];
const createdFrom = q['createdFrom'];
const createdTo = q['createdTo'];
const propFilters: Record<string, string> = {};
for (const [k, v] of Object.entries(q)) {
  const m = k.match(/^filter\[(.+)\]$/);
  if (m?.[1]) propFilters[m[1]] = v;
}
```

Then find the `conditions` array initialization (around line 225):
```typescript
const conditions: any[] = [eq(deals.pipelineId, pipelineId)];
if (!includeArchived) conditions.push(isNull(deals.archivedAt));
```
Replace with:
```typescript
const conditions: any[] = [eq(deals.pipelineId, pipelineId)];
if (!includeArchived) conditions.push(isNull(deals.archivedAt));
if (filterOwnerUserId) conditions.push(eq(deals.ownerUserId, filterOwnerUserId));
if (createdFrom) conditions.push(gte(deals.createdAt, new Date(createdFrom)));
if (createdTo) conditions.push(lte(deals.createdAt, new Date(createdTo)));
for (const [key, val] of Object.entries(propFilters)) {
  conditions.push(
    sql`EXISTS (
      SELECT 1 FROM deal_property_values dpv
      JOIN property_definitions pd ON dpv.property_definition_id = pd.id
      WHERE dpv.deal_id = ${deals.id} AND pd.key = ${key} AND dpv.value = ${val}
    )` as any,
  );
}
```

Verify `gte` and `lte` are already imported at the top of the file — they are (line 7–8). No new imports needed.

### Part B: Frontend — filter bar and save view in kanban

- [ ] **Step 2: Update `SavedView` type to include structured filters**

Find the `SavedView` interface (around line 55) and update its `config` type:
```typescript
interface SavedView {
  id: string;
  name: string;
  isTeam: boolean;
  createdByUserId: string | null;
  config: {
    columns?: string[];
    filters?: {
      stageId?: string;
      ownerUserId?: string;
      createdFrom?: string;
      createdTo?: string;
      propFilters?: Record<string, string>;
    };
    sort?: string;
    sortDir?: 'asc' | 'desc';
    viewMode?: 'list' | 'kanban';
  };
}
```

- [ ] **Step 3: Update `applyView` to restore filters**

Find `applyView` (around line 263) and add filter restoration:
```typescript
function applyView(view: SavedView) {
  setActiveViewId(view.id);
  if (view.config.columns) setPropColumns(view.config.columns);
  if (view.config.sort) setSortField(view.config.sort);
  if (view.config.sortDir) setSortDir(view.config.sortDir);
  if (view.config.viewMode) setViewMode(view.config.viewMode);
  if (view.config.filters) {
    const f = view.config.filters;
    setFilterStageId(f.stageId ?? '');
    setFilterOwnerUserId(f.ownerUserId ?? '');
    setCreatedFrom(f.createdFrom ?? '');
    setCreatedTo(f.createdTo ?? '');
    setPropFilters(f.propFilters ?? {});
  }
  setPage(1);
}
```

- [ ] **Step 4: Update `handleSaveView` to include filters in saved config**

Find `handleSaveView` (around line 272). Update the `config` object:
```typescript
  const view = await api.post('/api/saved-views', {
    name: viewName.trim(),
    objectType: 'deal',
    config: {
      columns: propColumns,
      sort: sortField,
      sortDir,
      viewMode,
      filters: {
        stageId: filterStageId,
        ownerUserId: filterOwnerUserId,
        createdFrom,
        createdTo,
        propFilters,
      },
    },
    isTeam,
  });
```

- [ ] **Step 5: Build a `buildKanbanParams` helper and update `refreshKanban`**

Find the `refreshKanban` function (around line 224). Replace it with:
```typescript
function buildKanbanParams() {
  const params = new URLSearchParams({ pipelineId: selectedPipelineId });
  if (includeArchived) params.set('includeArchived', 'true');
  if (filterOwnerUserId) params.set('ownerUserId', filterOwnerUserId);
  if (createdFrom) params.set('createdFrom', createdFrom);
  if (createdTo) params.set('createdTo', createdTo);
  for (const [key, val] of Object.entries(propFilters)) {
    if (val) params.set(`filter[${key}]`, val);
  }
  return params.toString();
}

function refreshKanban() {
  if (!selectedPipelineId) return;
  api.get(`/api/deals/kanban?${buildKanbanParams()}`)
    .then(setKanbanData)
    .catch(() => {});
}
```

- [ ] **Step 6: Update the kanban fetch `useEffect` to depend on filter state**

Find the kanban fetch `useEffect` (around line 213):
```typescript
  useEffect(() => {
    if (viewMode !== 'kanban' || !selectedPipelineId) return;
    setKanbanLoading(true);
    api.get(`/api/deals/kanban?pipelineId=${selectedPipelineId}${includeArchived ? '&includeArchived=true' : ''}`)
      .then((res) => {
        setKanbanData(res);
        setKanbanLoading(false);
      })
      .catch(() => setKanbanLoading(false));
  }, [viewMode, selectedPipelineId, includeArchived]);
```

Replace with:
```typescript
  useEffect(() => {
    if (viewMode !== 'kanban' || !selectedPipelineId) return;
    setKanbanLoading(true);
    api.get(`/api/deals/kanban?${buildKanbanParams()}`)
      .then((res) => {
        setKanbanData(res);
        setKanbanLoading(false);
      })
      .catch(() => setKanbanLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedPipelineId, includeArchived, filterOwnerUserId, createdFrom, createdTo, propFilters]);
```

Note: `buildKanbanParams` is a regular function defined in the component, not a stable reference, so listing the underlying state deps is correct.

- [ ] **Step 7: Show filter toggle and save-view buttons in kanban mode**

Find line 425 (the filter toggle button condition):
```tsx
        {viewMode === 'list' && (
          <button
            onClick={() => setShowFilterBar(!showFilterBar)}
```
Change `viewMode === 'list'` to `true` (remove the condition entirely so it shows in both modes). Keep the button markup unchanged:
```tsx
        <button
          onClick={() => setShowFilterBar(!showFilterBar)}
          style={{
            background: activeFilterCount > 0 ? '#eef2ff' : '#fff',
            borderColor: activeFilterCount > 0 ? 'var(--color-primary)' : 'var(--color-border)',
            color: activeFilterCount > 0 ? 'var(--color-primary)' : '#555',
            border: '1px solid',
            padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          Filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} ▾
        </button>
```

Find line 440 (the column picker condition `{viewMode === 'list' && (...)}`). Leave that condition as-is — column picker stays list-only.

Find line 482 (the save-view button condition):
```tsx
        {viewMode === 'list' && (
          <div style={{ position: 'relative' }}>
```
Change `viewMode === 'list'` to `true`:
```tsx
        <div style={{ position: 'relative' }}>
```
(Remove the outer `{viewMode === 'list' && (...)}` wrapper, keeping the inner div and all its children unchanged.)

- [ ] **Step 8: Hide stage filter inside the filter bar when in kanban mode**

Find the stage filter block inside the filter bar (around line 596):
```tsx
            {/* Stage filter */}
            {currentPipeline && currentPipeline.stages.length > 0 && (
```
Change to:
```tsx
            {/* Stage filter — only in list mode (kanban columns are already per-stage) */}
            {viewMode === 'list' && currentPipeline && currentPipeline.stages.length > 0 && (
```

- [ ] **Step 9: Verify manually**

1. Switch to Kanban view — "Filtres" button should now appear.
2. Click "Filtres" — filter bar should open (no stage filter shown).
3. Filter by owner or a property value — kanban should update.
4. Click "Guardar vista", enter a name, save — reload page, verify the saved view tab restores the filters.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/deals.ts apps/web/src/pages/DealsListPage.tsx
git commit -m "feat(web,api): add filter bar and save-view to kanban deals view

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 3: Group Dropdown in Property Admin

Replace the free-text input for "Grup de display" with an HTML5 datalist combo that shows existing groups as suggestions while still allowing custom values.

**Files:**
- Modify: `apps/web/src/pages/AdminPropertiesPage.tsx`

### Context

- `defs` state (line 44) contains all loaded property definitions.
- The group input is at line 328–339 in the `showCreate` modal.
- `form.group` is a `string` (empty string = no group).

- [ ] **Step 1: Derive `distinctGroups` from `defs`**

In `AdminPropertiesPage` function, after `const displayed = ...` (line 75), add:
```typescript
const distinctGroups = [...new Set(defs.map((d) => d.group).filter((g): g is string => Boolean(g)))];
```

- [ ] **Step 2: Replace the text input with a datalist combo**

Find lines 328–339:
```tsx
            <Field label="Grup de display">
              <input
                type="text"
                value={form.group}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                placeholder="p.ex. Atribució, Aircall, Consulta"
                style={{ ...inputStyle, width: '100%' }}
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                Deixa en blanc si no cal agrupar. Els noms de grup han de coincidir exactament.
              </div>
            </Field>
```
Replace with:
```tsx
            <Field label="Grup de display">
              <input
                type="text"
                list="group-suggestions"
                value={form.group}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                placeholder="Selecciona o escriu un nou grup..."
                style={{ ...inputStyle, width: '100%' }}
              />
              <datalist id="group-suggestions">
                {distinctGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                Deixa en blanc per no agrupar. Pots seleccionar un grup existent o escriure&apos;n un de nou.
              </div>
            </Field>
```

- [ ] **Step 3: Verify manually**

1. Go to Admin → Properties.
2. Click "Editar" on any property.
3. Click the "Grup de display" field — a dropdown with existing group names should appear.
4. Select an existing group or type a new name.
5. Save and verify the group is updated in the table.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AdminPropertiesPage.tsx
git commit -m "feat(web): replace group text input with datalist dropdown in property admin

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 4: Group Management UI

Add API endpoints to rename or delete a group across all properties, and add a "Gestionar grups" modal to the property admin page.

**Files:**
- Modify: `apps/api/src/routes/properties.ts`
- Modify: `apps/web/src/pages/AdminPropertiesPage.tsx`

### Context

- Groups are free-text values stored in `property_definitions.group`.
- No separate groups table exists.
- "Rename group" = `UPDATE property_definitions SET group = $to WHERE group = $from`.
- "Delete group" = `UPDATE property_definitions SET group = NULL WHERE group = $name`.
- Both are admin-only, bulk operations.
- The existing `PATCH /api/properties/:id` endpoint handles `group` per-property; we need new bulk endpoints.

### Part A: API endpoints

- [ ] **Step 1: Add rename and delete-group endpoints to `apps/api/src/routes/properties.ts`**

At the end of the file, before the closing `}` of `propertiesRoutes`, add:

```typescript
  // PATCH /api/property-groups/rename — admin only
  // body: { from: string, to: string }
  app.patch(
    '/api/property-groups/rename',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const body = req.body as { from?: string; to?: string };
      if (!body.from || !body.to) {
        return reply.status(400).send({ error: 'from and to are required' });
      }
      const { from: fromName, to: toName } = body;
      await app.db
        .update(propertyDefinitions)
        .set({ group: toName, updatedAt: new Date() })
        .where(eq(propertyDefinitions.group, fromName));
      await app.audit({
        userId: req.user!.id,
        action: 'update',
        objectType: 'property_group',
        objectId: fromName,
        diff: { before: { group: fromName }, after: { group: toName } },
      });
      return { ok: true };
    },
  );

  // DELETE /api/property-groups/:name — admin only
  // Clears group = null on all matching properties
  app.delete(
    '/api/property-groups/:name',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      await app.db
        .update(propertyDefinitions)
        .set({ group: null, updatedAt: new Date() })
        .where(eq(propertyDefinitions.group, name));
      await app.audit({
        userId: req.user!.id,
        action: 'delete',
        objectType: 'property_group',
        objectId: name,
        diff: { before: { group: name }, after: { group: null } },
      });
      return reply.status(204).send();
    },
  );
```

Note: `eq` is already imported. `propertyDefinitions` is already imported. No new imports needed.

### Part B: Frontend group management modal

- [ ] **Step 2: Add `showManageGroups` state to `AdminPropertiesPage`**

After `const [deletingId, setDeletingId] = useState<string | null>(null);` (line 57), add:
```typescript
const [showManageGroups, setShowManageGroups] = useState(false);
```

- [ ] **Step 3: Update `load` function to refresh `defs` after group rename/delete**

The existing `load()` function already refreshes `defs`. It will be called from the group modal after mutations.

- [ ] **Step 4: Add "Gestionar grups" button to the header**

Find the header div (around line 162–167):
```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Propietats dinàmiques</h1>
        <span style={{ color: '#999', fontSize: 13 }}>{defs.length} definicions</span>
        <div style={{ flex: 1 }} />
        <button onClick={startCreate} style={primaryBtn}>+ Nova propietat</button>
      </div>
```
Replace with:
```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Propietats dinàmiques</h1>
        <span style={{ color: '#999', fontSize: 13 }}>{defs.length} definicions</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowManageGroups(true)}
          style={outlineBtn}
        >
          Gestionar grups
        </button>
        <button onClick={startCreate} style={primaryBtn}>+ Nova propietat</button>
      </div>
```

- [ ] **Step 5: Wire the modal in JSX**

Find the end of `AdminPropertiesPage` return, just before the closing `</div>` (around line 391):
```tsx
    </div>
  );
}
```
Insert before the closing `</div>`:
```tsx
      {showManageGroups && (
        <GroupManageModal
          groups={distinctGroups}
          onClose={() => setShowManageGroups(false)}
          onChanged={() => { load(); }}
        />
      )}
```

Note: `distinctGroups` must be computed before the return statement (it was added in Task 3, Step 1). If Task 3 was not done yet, add it now:
```typescript
const distinctGroups = [...new Set(defs.map((d) => d.group).filter((g): g is string => Boolean(g)))];
```

- [ ] **Step 6: Add `GroupManageModal` component at the bottom of `AdminPropertiesPage.tsx`**

After the `emptyForm` function (end of file, around line 556), add:

```tsx
// ─── Group Management Modal ────────────────────────────────────────────────────

function GroupManageModal({
  groups,
  onClose,
  onChanged,
}: {
  groups: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleRename(from: string) {
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.patch('/api/property-groups/rename', { from, to: newName.trim() });
      setRenamingGroup(null);
      setNewName('');
      onChanged();
    } catch (e: any) {
      setError(e.message ?? 'Error en canviar el nom.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Eliminar el grup "${name}"? Totes les propietats d'aquest grup quedaran sense grup.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/property-groups/${encodeURIComponent(name)}`);
      onChanged();
    } catch (e: any) {
      setError(e.message ?? 'Error en eliminar el grup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Gestionar grups" onClose={onClose}>
      {groups.length === 0 ? (
        <p style={{ fontSize: 13, color: '#999' }}>No hi ha grups definits.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: '#555', fontSize: 11 }}>Nom del grup</th>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '8px 8px' }}>
                  {renamingGroup === g ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRename(g); if (e.key === 'Escape') { setRenamingGroup(null); setNewName(''); } }}
                        style={{ ...inputStyle, width: 180 }}
                      />
                      <button
                        onClick={() => handleRename(g)}
                        disabled={busy || !newName.trim()}
                        style={{ ...smallBtn, color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
                      >
                        Guardar
                      </button>
                      <button onClick={() => { setRenamingGroup(null); setNewName(''); }} style={smallBtn}>
                        Cancel·lar
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontWeight: 500 }}>{g}</span>
                  )}
                </td>
                <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                  {renamingGroup !== g && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => { setRenamingGroup(g); setNewName(g); }}
                        style={smallBtn}
                        disabled={busy}
                      >
                        Reanomenar
                      </button>
                      <button
                        onClick={() => handleDelete(g)}
                        style={{ ...smallBtn, color: '#e74c3c', borderColor: '#e74c3c' }}
                        disabled={busy}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <div style={{ color: '#e74c3c', fontSize: 13, marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={onClose} style={outlineBtn}>Tancar</button>
      </div>
    </Modal>
  );
}
```

Note: `Modal`, `inputStyle`, `smallBtn`, `outlineBtn` are all defined elsewhere in `AdminPropertiesPage.tsx` — no new imports needed.

- [ ] **Step 7: Verify manually**

1. Go to Admin → Properties.
2. Click "Gestionar grups" — modal should appear listing all groups.
3. Click "Reanomenar" on a group, type a new name, click "Guardar" — table should refresh with updated group.
4. Click "Eliminar" on a group, confirm — table should refresh, properties should show "—" for that group.
5. Verify the datalist in the property edit modal (Task 3) now shows the updated group names.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/properties.ts apps/web/src/pages/AdminPropertiesPage.tsx
git commit -m "feat(web,api): add group management UI and bulk rename/delete API

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 5: Contact List — Column Reordering and Sortable Headers

Add two features to the contacts list that the deals list already has: drag-to-reorder dynamic property columns, and click-to-sort on column headers.

**Files:**
- Modify: `apps/web/src/pages/ContactsListPage.tsx`

### Context

- `propColumns` state (line 64) holds the ordered list of property column keys.
- The deals list reorders columns using `dragColRef`, `handleColDragStart`, and `handleColDrop` (DealsListPage.tsx:810–827).
- The deals list sorts via `sortField`/`sortDir` state and `onSort` callback.
- The contacts API (`GET /api/contacts`) already accepts `sort` and `sortDir` params with base fields: `created_at`, `updated_at`, `first_name`, `last_name`, `email`, `phone_e164`.
- The current `Th` component (line 605) is a simple wrapper — it needs to become a smart component that conditionally renders a sort button.
- Dynamic property columns cannot be sorted server-side (no API support for property value sorting); only base field columns get sort arrows.

### Part A: Sort state and API wiring

- [ ] **Step 1: Add `sortField` and `sortDir` state**

After `const [showFilterBar, setShowFilterBar] = useState(false);` (line 72), add:
```typescript
const [sortField, setSortField] = useState('created_at');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
```

- [ ] **Step 2: Pass sort params to the contacts fetch**

In the fetch `useEffect`, find where params are built (around line 107). After:
```typescript
    params.set('pageSize', String(pageSize));
```
Add:
```typescript
    params.set('sort', sortField);
    params.set('sortDir', sortDir);
```
Add `sortField` and `sortDir` to the dependency array (line 136):
```typescript
  }, [debouncedSearch, includeArchived, page, propColumns, createdFrom, createdTo, propFilters, sortField, sortDir]);
```

- [ ] **Step 3: Add `handleSort` function**

After `clearFilters` function (around line 173), add:
```typescript
function handleSort(field: string) {
  if (sortField === field) {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  } else {
    setSortField(field);
    setSortDir('asc');
  }
  setPage(1);
}
```

- [ ] **Step 4: Include sort in saved view config**

In `handleSaveView` (line 152), update the config:
```typescript
        config: { columns: propColumns, sort: sortField, sortDir },
```

In `applyView` (line 138), restore sort:
```typescript
  function applyView(view: SavedView) {
    setActiveViewId(view.id);
    if (view.config.columns) setPropColumns(view.config.columns);
    if (view.config.sort) setSortField(view.config.sort);
    if (view.config.sortDir) setSortDir(view.config.sortDir);
    if (view.config.filters) {
      const q = (view.config.filters as any)['q'];
      if (q) setSearch(q);
    }
    setPage(1);
  }
```

Also update the `SavedView` interface `config` type to add `sort` and `sortDir`:
```typescript
  config: {
    columns?: string[];
    filters?: Record<string, string>;
    sort?: string;
    sortDir?: 'asc' | 'desc';
  };
```
(This field was already in the interface definition — verify it's there; if not, add it.)

### Part B: Sortable column headers

- [ ] **Step 5: Replace fixed `Th` with a sortable header in the table**

The `Th` component at line 605 is used for all headers. The table headers (lines 469–477) currently look like:
```tsx
              <tr>
                <Th>Nom</Th>
                <Th>Telèfon</Th>
                <Th>Email</Th>
                {propColumns.map((key) => (
                  <Th key={key}>{propLabel(key)}</Th>
                ))}
                <Th>Creat</Th>
              </tr>
```

Replace with:
```tsx
              <tr>
                <SortableTh field="first_name" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Nom</SortableTh>
                <Th>Telèfon</Th>
                <SortableTh field="email" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Email</SortableTh>
                {propColumns.map((key) => (
                  <th
                    key={key}
                    draggable
                    onDragStart={() => { dragColRef.current = key; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const from = dragColRef.current;
                      dragColRef.current = null;
                      if (!from || from === key) return;
                      const cols = [...propColumns];
                      const fi = cols.indexOf(from);
                      const ti = cols.indexOf(key);
                      if (fi === -1 || ti === -1) return;
                      cols.splice(fi, 1);
                      cols.splice(ti, 0, from);
                      setPropColumns(cols);
                    }}
                    style={{
                      padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                      color: '#888', textTransform: 'uppercase', letterSpacing: 0.5,
                      background: '#f9f9f9', borderBottom: '1px solid var(--color-border)',
                      position: 'sticky', top: 0, cursor: 'grab', userSelect: 'none',
                    }}
                  >
                    {propLabel(key)}
                  </th>
                ))}
                <SortableTh field="created_at" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Creat</SortableTh>
              </tr>
```

- [ ] **Step 6: Add `dragColRef` and `SortableTh` component**

After `const searchDebounceRef = useRef<...>()` (line 85), add:
```typescript
const dragColRef = useRef<string | null>(null);
```

After the `Th` component (around line 618), add:
```tsx
function SortableTh({
  field,
  sortField,
  sortDir,
  onSort,
  children,
}: {
  field: string;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  children: React.ReactNode;
}) {
  const isActive = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        color: isActive ? 'var(--color-primary)' : '#888',
        textTransform: 'uppercase', letterSpacing: 0.5,
        background: '#f9f9f9', borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {children}
      {isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
    </th>
  );
}
```

- [ ] **Step 7: Verify manually**

1. Go to Contacts list.
2. Click "Nom" header — contacts should sort by first name A→Z. Click again → Z→A.
3. Click "Email" header — sorts by email.
4. Click "Creat" header — sorts by creation date.
5. Add two dynamic prop columns, then drag one column header over the other — order should swap.
6. Save a view — reload page, apply the view — sort and column order should be restored.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/ContactsListPage.tsx
git commit -m "feat(web): add sortable headers and drag-to-reorder columns to contacts list

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Post-implementation checklist

- [ ] All six features work end-to-end in the browser.
- [ ] No TypeScript errors: run `pnpm --filter web tsc --noEmit` and `pnpm --filter api tsc --noEmit`.
- [ ] Kanban deals update when filters change.
- [ ] Saved views with filters round-trip correctly (save → reload → apply → correct filter state).
- [ ] Contact list column drag-reorder works for dynamic property columns.
- [ ] Contact list sort persists in saved views.

---

## Task 6: Deals List Sort Visuals + Contacts Telèfon Sort

Align the deals list sortable column header visuals with the contacts list style, and add Telèfon as a sortable column in the contacts list.

**Files:**
- Modify: `apps/web/src/pages/DealsListPage.tsx`
- Modify: `apps/web/src/pages/ContactsListPage.tsx`

### Context

**Deals list current state (`ListView` component, `DealsListPage.tsx`):**
- Drag-to-reorder: already works on prop columns via `handleColDragStart`/`handleColDrop` ✓
- Sort: Pipeline·Etapa (`current_stage_entered_at`) and Creat (`created_at`) already have `onClick` handlers ✓
- Visual gap: uses a plain `sortIcon` helper (`▲`/`▼` only when active, nothing when inactive) — no active color highlight, no ↕ indicator for sortable-but-inactive columns
- The contacts list uses a `SortableTh` component that shows active primary color + ↕ when inactive — this is the style to match

**Contacts list current state (`ContactsListPage.tsx`):**
- Telèfon (`phone_e164`) is NOT sortable, but the contacts API already supports `phone_e164` as a sort field
- Adding it is a one-liner: replace `<Th>Telèfon</Th>` with `<SortableTh field="phone_e164" ...>Telèfon</SortableTh>`

**What does NOT need changing:**
- Contacte and Responsable columns in deals list cannot be sorted server-side (both require JOINs not supported by the current sort API)
- The drag-to-reorder behaviour itself is already identical between deals and contacts lists — only the visual sort indicators differ

### Part A: Deals list — adopt `SortableTh` style

- [ ] **Step 1: Add a `SortableTh` component to `DealsListPage.tsx`**

`SortableTh` is already defined in `ContactsListPage.tsx` (lines 620–650). Add the identical component at the bottom of `DealsListPage.tsx`, after the `formatPropValue` function:

```tsx
// ─── Sortable header ──────────────────────────────────────────────────────────

function SortableTh({
  field,
  sortField,
  sortDir,
  onSort,
  children,
}: {
  field: string;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  children: React.ReactNode;
}) {
  const isActive = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
        color: isActive ? 'var(--color-primary)' : '#555',
        whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
      }}
    >
      {children}
      {isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
    </th>
  );
}
```

Note: padding/font values match the existing `th` style object used in the deals list.

- [ ] **Step 2: Replace the inline sort `<th>` elements with `SortableTh`**

In `ListView` (around line 875), find the `<thead>` row. Replace:

```tsx
              <th
                style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => onSort('current_stage_entered_at')}
              >
                Pipeline · Etapa{sortIcon('current_stage_entered_at')}
              </th>
```
with:
```tsx
              <SortableTh field="current_stage_entered_at" sortField={sortField} sortDir={sortDir} onSort={onSort}>
                Pipeline · Etapa
              </SortableTh>
```

And replace:
```tsx
              <th
                style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => onSort('created_at')}
              >
                Creat{sortIcon('created_at')}
              </th>
```
with:
```tsx
              <SortableTh field="created_at" sortField={sortField} sortDir={sortDir} onSort={onSort}>
                Creat
              </SortableTh>
```

- [ ] **Step 3: Remove the now-unused `sortIcon` helper**

Find and delete:
```typescript
  const sortIcon = (field: string) =>
    sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
```

### Part B: Contacts list — add Telèfon sort

- [ ] **Step 4: Replace the plain `<Th>Telèfon</Th>` with `SortableTh`**

In `ContactsListPage.tsx`, find the thead row (around line 471):
```tsx
                <Th>Telèfon</Th>
```
Replace with:
```tsx
                <SortableTh field="phone_e164" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Telèfon</SortableTh>
```

No API changes needed — `GET /api/contacts` already accepts `sort=phone_e164`.

- [ ] **Step 5: Verify manually**

1. Open deals list view → click "Pipeline · Etapa" header — should highlight in primary color with ▲/▼, click again to flip direction.
2. Click "Creat" header — same behavior.
3. Click "Contacte" or "Responsable" — nothing should happen (they're plain `<th>` with no handler).
4. Hover over a prop column header in deals list — cursor should be 'grab', drag to reorder.
5. Open contacts list → click "Telèfon" header — should sort by phone number.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/DealsListPage.tsx apps/web/src/pages/ContactsListPage.tsx
git commit -m "feat(web): add sortable headers and drag-to-reorder columns to contacts list

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 7: Full Column Reorder + Sort on All Columns (Contacts & Deals Lists)

Make every column in both list views draggable and sortable — including fixed columns like Contacte, Nom, Telèfon, Creat. The current model keeps fixed and dynamic columns separate; this task unifies them into a single ordered array.

**Files:**
- Modify: `apps/web/src/pages/ContactsListPage.tsx`
- Modify: `apps/web/src/pages/DealsListPage.tsx`

**No API changes needed** — `GET /api/contacts` already supports `sort=first_name|phone_e164|email|created_at` and `GET /api/deals` already supports `sort=contact_first_name|contact_phone_e164|owner_name|current_stage_entered_at|created_at` (added in CEN-174).

### Design

Replace `propColumns: string[]` (dynamic columns only) with `allColumns: string[]` that contains **every** column key in render order — both fixed (prefixed with `_`) and dynamic property keys.

**Fixed column key conventions:**

Contacts: `_nom`, `_telefon`, `_email`, `_creat`
Deals: `_contacte`, `_telefon`, `_etapa`, `_responsable`, `_creat`

The API `columns` param still only receives dynamic property keys (the API ignores fixed column selection). Fixed columns are always fetched.

**Single `ColTh` component** replaces both `Th`, `SortableTh`, and the inline draggable `<th>` used for prop columns. It handles: draggable reorder, optional sort-on-click with active styling, and the ↕ indicator.

---

### Part A: Contacts List

- [ ] **Step 1: Define fixed column metadata constant**

At the top of `ContactsListPage.tsx`, after the `DEFAULT_PROP_COLUMNS` constant, add:

```typescript
const CONTACT_FIXED_COLS: Array<{ key: string; label: string; sortField?: string }> = [
  { key: '_nom',    label: 'Nom',     sortField: 'first_name' },
  { key: '_telefon', label: 'Telèfon', sortField: 'phone_e164' },
  { key: '_email',  label: 'Email',   sortField: 'email' },
  { key: '_creat',  label: 'Creat',   sortField: 'created_at' },
];
const CONTACT_FIXED_KEYS = new Set(CONTACT_FIXED_COLS.map((c) => c.key));

// Default full column order: fixed columns + default prop columns interleaved
const DEFAULT_ALL_COLUMNS = ['_nom', '_telefon', '_email', ...DEFAULT_PROP_COLUMNS, '_creat'];
```

- [ ] **Step 2: Replace `propColumns` state with `allColumns`**

Find:
```typescript
const [propColumns, setPropColumns] = useState<string[]>(DEFAULT_PROP_COLUMNS);
```
Replace with:
```typescript
const [allColumns, setAllColumns] = useState<string[]>(DEFAULT_ALL_COLUMNS);
```

Add a derived value right after the state declarations (before the `useEffect`s):
```typescript
const propColumns = allColumns.filter((k) => !CONTACT_FIXED_KEYS.has(k));
```

`propColumns` is now a derived read-only value — the fetch `useEffect` still uses it to build the `columns` param, so the API call is unchanged.

- [ ] **Step 3: Update `applyView` and `handleSaveView`**

`applyView` currently does `if (view.config.columns) setPropColumns(view.config.columns)`. Change to:
```typescript
  function applyView(view: SavedView) {
    setActiveViewId(view.id);
    if (view.config.columns) setAllColumns(view.config.columns);
    if (view.config.sort) setSortField(view.config.sort);
    if (view.config.sortDir) setSortDir(view.config.sortDir);
    if (view.config.filters) {
      const q = (view.config.filters as any)['q'];
      if (q) setSearch(q);
    }
    setPage(1);
  }
```

`handleSaveView` currently saves `{ columns: propColumns, ... }`. Change to:
```typescript
        config: { columns: allColumns, sort: sortField, sortDir },
```

- [ ] **Step 4: Update the "Tots" reset button to reset `allColumns`**

Find the "Tots" tab button (around line 430):
```typescript
onClick={() => { setActiveViewId(null); setPropColumns(DEFAULT_PROP_COLUMNS); setSearch(''); setPage(1); }}
```
Replace with:
```typescript
onClick={() => { setActiveViewId(null); setAllColumns(DEFAULT_ALL_COLUMNS); setSearch(''); setPage(1); }}
```

- [ ] **Step 5: Update the column picker to use `allColumns`**

The `ColumnPicker` component currently receives `selected={propColumns}` and calls `onChange` with only prop keys. Change so it:
1. Toggles prop columns in/out of `allColumns` (not a separate list)
2. Leaves fixed columns alone

Replace the `ColumnPicker` call (around line 272):
```tsx
          <ColumnPicker
            defs={propertyDefs.filter((d) => !['first_name','last_name','email','phone_e164'].includes(d.key))}
            selected={propColumns}
            onChange={(cols) => { setPropColumns(cols); setShowColumnPicker(false); }}
            onClose={() => setShowColumnPicker(false)}
          />
```
with:
```tsx
          <ColumnPicker
            defs={propertyDefs.filter((d) => !['first_name','last_name','email','phone_e164'].includes(d.key))}
            selected={propColumns}
            onChange={(newPropCols) => {
              // Rebuild allColumns: keep fixed cols in current position, replace dynamic portion
              setAllColumns((prev) => {
                // Remove any prop keys no longer selected
                const filtered = prev.filter((k) => CONTACT_FIXED_KEYS.has(k) || newPropCols.includes(k));
                // Append newly added prop keys before _creat
                const creatIdx = filtered.indexOf('_creat');
                const ins = creatIdx >= 0 ? creatIdx : filtered.length;
                const added = newPropCols.filter((k) => !filtered.includes(k));
                return [...filtered.slice(0, ins), ...added, ...filtered.slice(ins)];
              });
              setShowColumnPicker(false);
            }}
            onClose={() => setShowColumnPicker(false)}
          />
```

- [ ] **Step 6: Replace the table `<thead>` row with a unified `allColumns` render**

Find the `<thead>` section (around line 469–501). Replace the entire `<tr>` contents with:
```tsx
              <tr>
                {allColumns.map((key) => {
                  const fixed = CONTACT_FIXED_COLS.find((c) => c.key === key);
                  return (
                    <ColTh
                      key={key}
                      colKey={key}
                      label={fixed ? fixed.label : propLabel(key)}
                      sortField={fixed?.sortField}
                      activeSortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                      allColumns={allColumns}
                      setAllColumns={setAllColumns}
                      dragColRef={dragColRef}
                    />
                  );
                })}
              </tr>
```

- [ ] **Step 7: Update the table `<tbody>` row to render from `allColumns`**

Find where cells are rendered (around line 491–502). Replace with:
```tsx
                  {allColumns.map((key) => {
                    const isFixed = CONTACT_FIXED_KEYS.has(key);
                    if (isFixed) {
                      if (key === '_nom') return (
                        <Td key={key}>
                          <span style={{ fontWeight: 500 }}>{displayName(c)}</span>
                          {c.archivedAt && <span style={{ marginLeft: 6, fontSize: 10, color: '#999', background: '#eee', borderRadius: 3, padding: '1px 4px' }}>arxivat</span>}
                        </Td>
                      );
                      if (key === '_telefon') return <Td key={key}>{c.phoneE164 ?? '—'}</Td>;
                      if (key === '_email') return <Td key={key}>{c.email ?? '—'}</Td>;
                      if (key === '_creat') return <Td key={key}>{fmtDate(c.createdAt)}</Td>;
                    }
                    return <Td key={key}>{c.properties[key] ? propOptionLabel(key, c.properties[key]) : '—'}</Td>;
                  })}
```

- [ ] **Step 8: Add `ColTh` component**

Remove `SortableTh` (it's replaced by `ColTh`). After the `Th` component (around line 605), add:

```tsx
function ColTh({
  colKey, label, sortField, activeSortField, sortDir, onSort, allColumns, setAllColumns, dragColRef,
}: {
  colKey: string;
  label: string;
  sortField?: string;
  activeSortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (f: string) => void;
  allColumns: string[];
  setAllColumns: React.Dispatch<React.SetStateAction<string[]>>;
  dragColRef: React.MutableRefObject<string | null>;
}) {
  const isActive = !!sortField && activeSortField === sortField;

  function handleDragStart() { dragColRef.current = colKey; }
  function handleDrop() {
    const from = dragColRef.current;
    dragColRef.current = null;
    if (!from || from === colKey) return;
    setAllColumns((prev) => {
      const cols = [...prev];
      const fi = cols.indexOf(from);
      const ti = cols.indexOf(colKey);
      if (fi === -1 || ti === -1) return prev;
      cols.splice(fi, 1);
      cols.splice(ti, 0, from);
      return cols;
    });
  }

  return (
    <th
      draggable
      onDragStart={handleDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={sortField ? () => onSort(sortField) : undefined}
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 0.5,
        background: '#f9f9f9', borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0,
        cursor: sortField ? 'pointer' : 'grab',
        userSelect: 'none', whiteSpace: 'nowrap',
        color: isActive ? 'var(--color-primary)' : '#888',
      }}
    >
      {label}
      {sortField ? (isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕') : ''}
    </th>
  );
}
```

Also remove the now-unused `SortableTh` function.

---

### Part B: Deals List

Apply the same pattern to `DealsListPage.tsx`. The `ListView` component currently receives `propColumns` and `onReorderColumns` — these need to change.

- [ ] **Step 9: Define fixed column metadata for deals**

At the top of `DealsListPage.tsx` (after the type definitions, around line 88), add:

```typescript
const DEAL_FIXED_COLS: Array<{ key: string; label: string; sortField?: string }> = [
  { key: '_contacte',   label: 'Contacte',          sortField: 'contact_first_name' },
  { key: '_telefon',    label: 'Telèfon',            sortField: 'contact_phone_e164' },
  { key: '_etapa',      label: 'Pipeline · Etapa',   sortField: 'current_stage_entered_at' },
  { key: '_responsable', label: 'Responsable',       sortField: 'owner_name' },
  { key: '_creat',      label: 'Creat',              sortField: 'created_at' },
];
const DEAL_FIXED_KEYS = new Set(DEAL_FIXED_COLS.map((c) => c.key));

const DEFAULT_DEAL_COLUMNS = DEAL_FIXED_COLS.map((c) => c.key); // ['_contacte','_telefon','_etapa','_responsable','_creat']
```

- [ ] **Step 10: Replace `propColumns` state with `allColumns` in `DealsListPage`**

Find line 129:
```typescript
const [propColumns, setPropColumns] = useState<string[]>([]);
```
Replace with:
```typescript
const [allColumns, setAllColumns] = useState<string[]>(DEFAULT_DEAL_COLUMNS);
```

Add derived value after state declarations:
```typescript
const propColumns = allColumns.filter((k) => !DEAL_FIXED_KEYS.has(k));
```

- [ ] **Step 11: Update list fetch params, applyView, handleSaveView, reset button, and column picker**

In the list fetch `useEffect`, `propColumns` is already used correctly (derived value, unchanged).

`applyView` — change `setPropColumns(view.config.columns)` to `setAllColumns(view.config.columns ?? DEFAULT_DEAL_COLUMNS)`.

`handleSaveView` — change `columns: propColumns` to `columns: allColumns`.

The "Tots" reset button (around line 585):
```typescript
onClick={() => { setActiveViewId(null); setPropColumns([]); setSortField('created_at'); setSortDir('desc'); setPage(1); }}
```
→
```typescript
onClick={() => { setActiveViewId(null); setAllColumns(DEFAULT_DEAL_COLUMNS); setSortField('created_at'); setSortDir('desc'); setPage(1); }}
```

Column picker toggle (around line 511–515):
```typescript
              onChange={(e) => {
                setPropColumns(e.target.checked
                  ? [...propColumns, def.key]
                  : propColumns.filter((k) => k !== def.key));
              }}
```
→
```typescript
              onChange={(e) => {
                const key = def.key;
                setAllColumns((prev) => {
                  if (e.target.checked) {
                    if (prev.includes(key)) return prev;
                    const creatIdx = prev.indexOf('_creat');
                    const ins = creatIdx >= 0 ? creatIdx : prev.length;
                    return [...prev.slice(0, ins), key, ...prev.slice(ins)];
                  }
                  return prev.filter((k) => k !== key);
                });
              }}
```

- [ ] **Step 12: Update `ListView` component signature**

`ListView` currently receives `propColumns`, `onReorderColumns`. Change:

```typescript
// Remove from ListView props:
propColumns: string[];
onReorderColumns: (cols: string[]) => void;

// Add:
allColumns: string[];
setAllColumns: React.Dispatch<React.SetStateAction<string[]>>;
```

Update the call site (around line 766):
```tsx
          <ListView
            ...
            allColumns={allColumns}
            setAllColumns={setAllColumns}
            propertyDefs={propertyDefs}
            ...
          />
```

- [ ] **Step 13: Replace `ListView` thead and tbody with unified `allColumns` render**

Inside `ListView`, add derived value:
```typescript
const propColumns = allColumns.filter((k) => !DEAL_FIXED_KEYS.has(k));
```

Replace the entire `<thead><tr>` contents with:
```tsx
              <tr style={{ background: '#f9f9f9', borderBottom: '1px solid var(--color-border)' }}>
                {allColumns.map((key) => {
                  const fixed = DEAL_FIXED_COLS.find((c) => c.key === key);
                  return (
                    <ColTh
                      key={key}
                      colKey={key}
                      label={fixed ? fixed.label : (defFor(key)?.label ?? key)}
                      sortField={fixed?.sortField}
                      activeSortField={sortField}
                      sortDir={sortDir}
                      onSort={onSort}
                      allColumns={allColumns}
                      setAllColumns={setAllColumns}
                      dragColRef={dragColRef}
                    />
                  );
                })}
              </tr>
```

Replace the `<tbody>` row cells. Find where `<td>` cells are rendered per deal (around line 886). Replace with:
```tsx
                  {allColumns.map((key) => {
                    if (key === '_contacte') return (
                      <td key={key} style={td}>
                        <span style={{ fontWeight: 500 }}>{dealName(d)}</span>
                        {d.isClosedWon && <span style={{ marginLeft: 6, fontSize: 11, color: '#27ae60', fontWeight: 600 }}>Won</span>}
                        {d.isClosedLost && <span style={{ marginLeft: 6, fontSize: 11, color: '#e74c3c', fontWeight: 600 }}>Lost</span>}
                        {d.archivedAt && <span style={{ marginLeft: 6, fontSize: 10, background: '#eee', color: '#888', borderRadius: 3, padding: '1px 4px' }}>Arxivat</span>}
                      </td>
                    );
                    if (key === '_telefon') return <td key={key} style={{ ...td, color: '#666' }}>{d.primaryContact?.phoneE164 ?? '—'}</td>;
                    if (key === '_etapa') return (
                      <td key={key} style={td}>
                        <span style={{ color: '#888' }}>{d.pipelineName}</span>
                        <span style={{ color: '#ccc', margin: '0 4px' }}>·</span>
                        {d.stageName}
                      </td>
                    );
                    if (key === '_responsable') return <td key={key} style={{ ...td, color: '#666' }}>{d.ownerName ?? '—'}</td>;
                    if (key === '_creat') return <td key={key} style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{fmtDate(d.createdAt)}</td>;
                    // dynamic prop column
                    return (
                      <td key={key} style={{ ...td, color: '#666' }}>
                        {d.properties[key] ? formatPropValue(key, d.properties[key], defFor(key)) : '—'}
                      </td>
                    );
                  })}
```

Also update `colSpan` in the empty-row fallback:
```tsx
<td colSpan={allColumns.length} ...>
```

- [ ] **Step 14: Remove `handleColDragStart`, `handleColDrop`, and `sortIcon` from `ListView`**

These are now handled inside `ColTh`. Delete the three functions from `ListView`.

Also add `ColTh` to `DealsListPage.tsx` (same implementation as in contacts list — copy it verbatim). Remove `SortableTh` if present.

- [ ] **Step 15: Verify manually**

1. Contacts list: drag "Creat" header to the left of "Nom" — order should change and persist through page navigation.
2. Contacts list: click "Telèfon" header — sorts by phone.
3. Contacts list: save a view — reload, apply view — column order and sort are restored.
4. Deals list: drag "Responsable" before "Pipeline · Etapa" — order changes.
5. Deals list: click "Contacte" header — sorts by contact first name.
6. Deals list: click "Responsable" — sorts by owner name.
7. Deals list: add a dynamic property column — it appears before "Creat", can be dragged.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src/pages/ContactsListPage.tsx apps/web/src/pages/DealsListPage.tsx
git commit -m "feat(web): unified column model — all columns draggable and sortable in contacts and deals lists

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```
