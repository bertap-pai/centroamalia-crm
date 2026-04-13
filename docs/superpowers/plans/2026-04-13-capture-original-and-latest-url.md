# Capture Original and Latest URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `first_page_url` and `last_page_url` contact properties whenever a contact is created or updated via a form submission or a Meta lead.

**Architecture:** The properties `first_page_url` and `last_page_url` already exist in the DB (added in migration `0010_property_group.sql`). Two code sites need updating: (1) `forms.ts` — extract the referer URL earlier and sync it to contact properties independently of tracking params; (2) `meta-lead-processor.ts` — add a URL entry to `ATTR_PROPS` that looks for common URL field names in `extraFields` from the Meta lead form.

**Tech Stack:** TypeScript, Drizzle ORM, Fastify, Node.js built-in test runner (`node:test`)

---

## File Map

| File | Change |
|------|--------|
| `apps/api/src/routes/forms.ts` | Extract `sourceUrl` from referer before property sync; add URL property sync block after UTM sync |
| `apps/api/src/lib/meta-lead-processor.ts` | Add `first_page_url`/`last_page_url` entry to `ATTR_PROPS` |

No new migrations. No new files.

---

### Task 1: Sync page URL from form submission referer

**Context:** In `forms.ts`, the form submission handler already saves `sourceUrl = req.headers['referer']` to the `formSubmissions` table (line 484), but never syncs it to contact properties. The UTM sync at line 407-473 only runs if `trackingParams` is non-empty. We need the URL sync to run independently.

**Files:**
- Modify: `apps/api/src/routes/forms.ts` (lines ~278–490)

- [ ] **Step 1: Extract `sourceUrl` early in the handler**

In `apps/api/src/routes/forms.ts`, find this line near the top of the submit handler (around line 278–283):

```typescript
    // Extract tracking params before processing form fields
    const trackingParams = typeof body['_tracking'] === 'object' && body['_tracking'] !== null
      ? body['_tracking'] as Record<string, string>
      : {};
    delete body['_tracking'];
    delete body['_hp'];
```

Add `sourceUrl` extraction directly after it:

```typescript
    // Extract tracking params before processing form fields
    const trackingParams = typeof body['_tracking'] === 'object' && body['_tracking'] !== null
      ? body['_tracking'] as Record<string, string>
      : {};
    delete body['_tracking'];
    delete body['_hp'];

    const sourceUrl = req.headers['referer']?.toString() ?? null;
```

- [ ] **Step 2: Add URL property sync block after the UTM sync block**

Find the closing of the UTM sync block (around line 473):

```typescript
          }
        }
      }
    }
```

Insert a new block **between** the closing brace of the UTM `if` block and the closing brace of `if (emailValue || phoneValue)`. The structure currently looks like:

```typescript
      // Sync UTM tracking params and attribution to contact properties
      if (createdContactId && Object.keys(trackingParams).length > 0) {
        // ... UTM sync code ...
      }
    }  // closes if (emailValue || phoneValue)
```

Replace it so it becomes:

```typescript
      // Sync UTM tracking params and attribution to contact properties
      if (createdContactId && Object.keys(trackingParams).length > 0) {
        // ... (existing UTM sync code, unchanged) ...
      }

      // Sync page URL to first_page_url / last_page_url contact properties
      if (createdContactId && sourceUrl) {
        const urlPropDefs = await app.db
          .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
          .from(propertyDefinitions)
          .where(inArray(propertyDefinitions.key, ['first_page_url', 'last_page_url']));

        const urlPropByKey = new Map(urlPropDefs.map((p) => [p.key, p.id]));

        const lastUrlPropId = urlPropByKey.get('last_page_url');
        if (lastUrlPropId) {
          await app.db
            .insert(contactPropertyValues)
            .values({ contactId: createdContactId, propertyDefinitionId: lastUrlPropId, value: sourceUrl })
            .onConflictDoUpdate({
              target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
              set: { value: sourceUrl, updatedAt: new Date() },
            });
        }

        const firstUrlPropId = urlPropByKey.get('first_page_url');
        if (firstUrlPropId) {
          await app.db
            .insert(contactPropertyValues)
            .values({ contactId: createdContactId, propertyDefinitionId: firstUrlPropId, value: sourceUrl })
            .onConflictDoNothing();
        }
      }
    }  // closes if (emailValue || phoneValue)
```

- [ ] **Step 3: Remove the now-redundant inline referer capture at the bottom of the handler**

Find this line near the bottom of the handler (around line 484), where `sourceUrl` is passed to the DB insert:

```typescript
        sourceUrl: req.headers['referer']?.toString() ?? null,
```

Replace it with just:

```typescript
        sourceUrl,
```

(The variable was already extracted in Step 1.)

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/berta/.paperclip/instances/default/projects/1fa8b121-7f76-4804-a046-5fea17c1ed41/2b92850d-9359-476a-86c8-466bd7289c2e/_default
pnpm --filter @crm/api typecheck
```

Expected: exits with code 0, no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/berta/.paperclip/instances/default/projects/1fa8b121-7f76-4804-a046-5fea17c1ed41/2b92850d-9359-476a-86c8-466bd7289c2e/_default
git add apps/api/src/routes/forms.ts
git commit -m "feat: sync first_page_url and last_page_url from form submission referer

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Sync page URL from Meta lead extra fields

**Context:** Meta Lead Ads forms can include custom questions. Any unmapped field from `field_data` ends up in `mapped.extraFields` (a `Record<string, string>`). Common field names for a page URL question are `page_url`, `url`, and `landing_page_url`. In `meta-lead-processor.ts`, `ATTR_PROPS` (lines 187–202) drives all contact property upserts. Adding an entry there is all that's needed.

**Files:**
- Modify: `apps/api/src/lib/meta-lead-processor.ts` (lines ~187–202)

- [ ] **Step 1: Add the URL entry to ATTR_PROPS**

Find the `ATTR_PROPS` array in `meta-lead-processor.ts` (starts around line 187). The last entry currently is:

```typescript
    { first: 'first_meta_campaign_id', last: 'last_meta_campaign_id', value: leadData.campaign_id },
  ];
```

Add a new entry immediately before the closing `];`:

```typescript
    { first: 'first_meta_campaign_id', last: 'last_meta_campaign_id', value: leadData.campaign_id },
    {
      first: 'first_page_url',
      last: 'last_page_url',
      value: mapped.extraFields?.page_url ?? mapped.extraFields?.url ?? mapped.extraFields?.landing_page_url,
    },
  ];
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/berta/.paperclip/instances/default/projects/1fa8b121-7f76-4804-a046-5fea17c1ed41/2b92850d-9359-476a-86c8-466bd7289c2e/_default
pnpm --filter @crm/api typecheck
```

Expected: exits with code 0, no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/berta/.paperclip/instances/default/projects/1fa8b121-7f76-4804-a046-5fea17c1ed41/2b92850d-9359-476a-86c8-466bd7289c2e/_default
git add apps/api/src/lib/meta-lead-processor.ts
git commit -m "feat: sync first_page_url and last_page_url from Meta lead extra fields

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Self-review

**Spec coverage:**
- ✅ New contacts via form submission: `first_page_url` set on create (Task 1)
- ✅ Existing contacts via form submission: `last_page_url` updated (Task 1, `onConflictDoUpdate`)
- ✅ New contacts via Meta leads: `first_page_url` set if URL field present in Meta form (Task 2)
- ✅ Existing contacts via Meta leads: `last_page_url` updated (Task 2, same ATTR_PROPS upsert logic)
- ✅ Future sources (TikTok): no changes needed — TikTok would follow the same ATTR_PROPS pattern when implemented

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:** `sourceUrl` is `string | null`; the sync block guards with `if (createdContactId && sourceUrl)` ensuring it is `string` when used. `mapped.extraFields` is `Record<string, string> | undefined`; optional chaining handles the undefined case correctly.
