# Plan: CRM Task Section Improvements (CEN-187)
_2026-04-02_

## Context

Improvements requested by the board for the Tasks section of the CRM (`TasksPage.tsx` + `notes-tasks.ts` API route).

No DB migrations are needed — all changes are API-layer sorting and frontend UX.

---

## Changes

### 1. Row-level overdue highlight

**File:** `apps/web/src/pages/TasksPage.tsx`

Currently `isOverdue` only turns the due-date text red. The requirement asks for better highlighting.

Change: add a **left red border + light red background tint** to the entire task row when `isOverdue(task)` is true and the task status is `open`.

```ts
// inside the row's style object:
background: isOverdue(task) ? '#fff5f5' : '#fff',
borderLeft: isOverdue(task) ? '3px solid #e74c3c' : '3px solid transparent',
```

Keep the existing red text + ⚠ icon on the due date chip — the row highlight is additive.

---

### 2. Always show due date

**File:** `apps/web/src/pages/TasksPage.tsx`

Currently the due date chip is only rendered `if (task.dueAt)`. Show it always:
- If `task.dueAt` is set: render as today (with overdue styling if past).
- If `task.dueAt` is null: render a neutral chip `Sense venciment` in grey.

This makes the due-date column predictable in the card view.

---

### 3. Sorting controls

**File (API):** `apps/api/src/routes/notes-tasks.ts`

Add two optional query params to `GET /api/tasks`:
- `sortBy`: `created_at` (default) | `due_at` | `title`
- `sortDir`: `asc` | `desc` (default `desc` for dates; `asc` for title)

Map to Drizzle column expressions:

```ts
const colMap = { due_at: tasks.dueAt, title: tasks.title, created_at: tasks.createdAt };
const col = colMap[sortBy ?? 'created_at'] ?? tasks.createdAt;
const order = sortDir === 'asc' ? asc(col) : desc(col);
// .orderBy(order)
```

**File (frontend):** `apps/web/src/pages/TasksPage.tsx`

Add a sort selector in the header area (next to the open/done/all tabs):

```
Sort by: [Due date ▼] [Asc / Desc toggle]
```

Options: `Due date`, `Name`, `Created`.

Wire `sortBy` + `sortDir` state to the load function.

---

### 4. List view with selectable & sortable columns

**File:** `apps/web/src/pages/TasksPage.tsx`

Add a view toggle (card | list) button in the header — mirror the UX of `ContactsListPage.tsx`.

**List view** renders a `<table>` with sticky column headers. Available columns:

| Column key | Label | Sortable |
|---|---|---|
| `title` | Tasca | ✅ |
| `due_at` | Venciment | ✅ |
| `status` | Estat | ❌ |
| `assignee` | Assignat a | ❌ |
| `object` | Contacte / Deal | ❌ |
| `created_at` | Creat | ✅ |

Default columns shown: `title`, `due_at`, `status`, `assignee`, `object`.

**Column picker:** clicking a gear/columns icon opens a small dropdown checklist — same pattern as ContactsListPage. Columns state persists in `localStorage` under key `tasks_list_columns`.

**Sortable column headers:** clicking a column that is sortable toggles `sortBy`/`sortDir` and re-fetches. Show ▲/▼ arrow beside the active sort column.

**Overdue rows:** same left-border + background tint applies to list view rows.

The card view (`view === 'card'`, existing layout) is unchanged.

---

## File summary

| File | Change |
|---|---|
| `apps/api/src/routes/notes-tasks.ts` | Add `sortBy` + `sortDir` query params |
| `apps/web/src/pages/TasksPage.tsx` | Row overdue highlight, always-show due date, sort controls, list view |

No schema or migration changes required.

---

## Acceptance criteria

- [ ] Overdue open tasks have red left border + light red background tint in both views
- [ ] Due date always shown (null → "Sense venciment" in grey)
- [ ] Sort selector works for due date, name, created — API and frontend in sync
- [ ] List view renders a table with at least title, due date, status, assignee, contact/deal columns
- [ ] Columns in list view are selectable via a picker, persisted to localStorage
- [ ] Sortable columns in list view can be clicked to sort asc/desc
