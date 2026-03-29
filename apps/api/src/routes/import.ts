/**
 * POST /api/import
 * Multipart upload: field "file" (.xlsx or .csv), field "dryRun" ('true'|'false')
 *
 * Sheet/file mapping (Excel workbook or individual CSV files with "sheet" field):
 *   contacts     — phone*, first_name, last_name, email, [property columns]
 *   deals        — external_id*, pipeline_slug*, stage_slug*, owner_email, [property columns]
 *   deal_contacts — deal_external_id*, phone*, is_primary ('true'/'1'), role
 *
 * Idempotency:
 *   contacts: upsert on phone_e164 (normalised)
 *   deals:    upsert on external_id
 *
 * dryRun=true → validate only, return report, no DB writes
 * dryRun=false → write and return report
 */

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import * as XLSX from 'xlsx';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import {
  contacts,
  deals,
  dealContacts,
  dealStageEvents,
  dealPropertyValues,
  pipelines,
  stages,
  users,
  propertyDefinitions,
  contactPropertyValues,
} from '@crm/db';
import { normalizePhone } from '../lib/phone.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportRow {
  rowIndex: number;
  sheet: string;
  errors: string[];
  warnings: string[];
  action: 'create' | 'update' | 'skip' | null;
}

interface ImportReport {
  dryRun: boolean;
  contacts: { total: number; created: number; updated: number; skipped: number; errors: number };
  deals: { total: number; created: number; updated: number; skipped: number; errors: number };
  dealContacts: { total: number; linked: number; skipped: number; errors: number };
  rows: ImportRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sheetToRows(ws: XLSX.WorkSheet): Record<string, string>[] {
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: false,
  });
  return json.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k.toLowerCase().trim()] = String(v ?? '').trim();
    }
    return out;
  });
}

function csvToRows(buf: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  return sheetToRows(ws!);
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default async function importRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  });

  app.post('/api/import', { preHandler: app.requireAdmin }, async (req, reply) => {
    // ── Parse multipart ──
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let dryRun = true;
    let sheetOverride = ''; // for CSV: which sheet name this file represents

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileName = part.filename ?? '';
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      } else if (part.type === 'field' && part.fieldname === 'dryRun') {
        dryRun = part.value !== 'false';
      } else if (part.type === 'field' && part.fieldname === 'sheet') {
        sheetOverride = String(part.value ?? '');
      }
    }

    if (!fileBuffer || !fileName) {
      return reply.code(400).send({ error: 'file_required' });
    }

    // ── Parse workbook ──
    const ext = fileName.split('.').pop()?.toLowerCase();
    const isExcel = ext === 'xlsx' || ext === 'xls';
    const isCsv = ext === 'csv';
    if (!isExcel && !isCsv) {
      return reply.code(400).send({ error: 'unsupported_file_type', supported: ['xlsx', 'xls', 'csv'] });
    }

    let contactRows: Record<string, string>[] = [];
    let dealRows: Record<string, string>[] = [];
    let dealContactRows: Record<string, string>[] = [];

    if (isExcel) {
      const wb = XLSX.read(fileBuffer, { type: 'buffer' });
      for (const name of wb.SheetNames) {
        const normalized = name.toLowerCase().replace(/[^a-z_]/g, '');
        const ws = wb.Sheets[name]!;
        if (normalized === 'contacts' || normalized === 'contactes') {
          contactRows = sheetToRows(ws);
        } else if (normalized === 'deals' || normalized === 'opportunitats') {
          dealRows = sheetToRows(ws);
        } else if (normalized === 'dealcontacts' || normalized === 'deal_contacts') {
          dealContactRows = sheetToRows(ws);
        }
      }
    } else {
      // CSV: single sheet, use sheetOverride to identify
      const rows = csvToRows(fileBuffer);
      const sheet = (sheetOverride || 'contacts').toLowerCase();
      if (sheet === 'contacts' || sheet === 'contactes') contactRows = rows;
      else if (sheet === 'deals' || sheet === 'opportunitats') dealRows = rows;
      else if (sheet === 'deal_contacts') dealContactRows = rows;
      else contactRows = rows; // default
    }

    // ── Load reference data ──
    const [allPipelines, allStages, allUsers, allPropDefs] = await Promise.all([
      app.db.select().from(pipelines),
      app.db.select().from(stages),
      app.db.select().from(users),
      app.db.select().from(propertyDefinitions),
    ]);

    const pipelineBySlug = new Map(allPipelines.map((p) => [p.slug, p]));
    const stageByPipelineAndSlug = new Map(
      allStages.map((s) => [`${s.pipelineId}::${s.slug}`, s]),
    );
    const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
    const propDefByKey = new Map(allPropDefs.map((d) => [d.key, d]));

    const coreContactKeys = new Set(['phone', 'first_name', 'last_name', 'email']);
    const coreDealKeys = new Set(['external_id', 'pipeline_slug', 'stage_slug', 'owner_email']);

    const report: ImportReport = {
      dryRun,
      contacts: { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
      deals: { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
      dealContacts: { total: 0, linked: 0, skipped: 0, errors: 0 },
      rows: [],
    };

    // ── Track created/updated IDs for deal_contacts linkage ──
    const externalIdToDbId = new Map<string, string>(); // externalId → deal.id
    const phoneToContactId = new Map<string, string>();  // phoneE164 → contact.id

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CONTACTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report.contacts.total = contactRows.length;
    for (let i = 0; i < contactRows.length; i++) {
      const row = contactRows[i]!;
      const rpt: ImportRow = { rowIndex: i + 2, sheet: 'contacts', errors: [], warnings: [], action: null };

      const rawPhone = row['phone'] ?? row['phone_e164'] ?? '';
      if (!rawPhone) {
        rpt.errors.push('Missing required column: phone');
        report.contacts.errors++;
        report.rows.push(rpt);
        continue;
      }
      const phoneE164 = normalizePhone(rawPhone);
      if (!phoneE164) {
        rpt.errors.push(`Invalid phone: "${rawPhone}"`);
        report.contacts.errors++;
        report.rows.push(rpt);
        continue;
      }

      // Dynamic property columns
      const propUpdates: Record<string, string> = {};
      for (const [col, val] of Object.entries(row)) {
        if (!coreContactKeys.has(col) && val && propDefByKey.has(col)) {
          propUpdates[col] = val;
        }
      }

      if (!dryRun) {
        // Upsert contact
        const [existing] = await app.db
          .select()
          .from(contacts)
          .where(eq(contacts.phoneE164, phoneE164))
          .limit(1);

        let contactId: string;
        if (existing) {
          const updates: Record<string, any> = {};
          if (row['first_name']) updates['firstName'] = row['first_name'];
          if (row['last_name']) updates['lastName'] = row['last_name'];
          if (row['email']) updates['email'] = row['email'];
          if (Object.keys(updates).length > 0) {
            await app.db.update(contacts).set(updates).where(eq(contacts.id, existing.id));
          }
          contactId = existing.id;
          rpt.action = 'update';
          report.contacts.updated++;
        } else {
          const [created] = await app.db
            .insert(contacts)
            .values({
              phoneE164,
              firstName: row['first_name'] || null,
              lastName: row['last_name'] || null,
              email: row['email'] || null,
              createdByUserId: req.user!.id,
            })
            .returning({ id: contacts.id });
          contactId = created!.id;
          rpt.action = 'create';
          report.contacts.created++;
        }

        // Property values
        for (const [key, val] of Object.entries(propUpdates)) {
          const pd = propDefByKey.get(key)!;
          await app.db
            .insert(contactPropertyValues)
            .values({ contactId, propertyDefinitionId: pd.id, value: val })
            .onConflictDoUpdate({
              target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
              set: { value: val, updatedAt: new Date() },
            });
        }

        phoneToContactId.set(phoneE164, contactId);
      } else {
        // dry-run: check existence only
        const [existing] = await app.db
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.phoneE164, phoneE164))
          .limit(1);
        rpt.action = existing ? 'update' : 'create';
        if (existing) {
          report.contacts.updated++;
          phoneToContactId.set(phoneE164, existing.id);
        } else {
          report.contacts.created++;
        }
      }

      report.rows.push(rpt);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DEALS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report.deals.total = dealRows.length;
    for (let i = 0; i < dealRows.length; i++) {
      const row = dealRows[i]!;
      const rpt: ImportRow = { rowIndex: i + 2, sheet: 'deals', errors: [], warnings: [], action: null };

      const externalId = row['external_id'] ?? '';
      const pipelineSlug = row['pipeline_slug'] ?? '';
      const stageSlug = row['stage_slug'] ?? '';

      if (!externalId) { rpt.errors.push('Missing: external_id'); }
      if (!pipelineSlug) { rpt.errors.push('Missing: pipeline_slug'); }
      if (!stageSlug) { rpt.errors.push('Missing: stage_slug'); }

      if (rpt.errors.length > 0) {
        report.deals.errors++;
        report.rows.push(rpt);
        continue;
      }

      const pipeline = pipelineBySlug.get(pipelineSlug);
      if (!pipeline) {
        rpt.errors.push(`Unknown pipeline_slug: "${pipelineSlug}"`);
        report.deals.errors++;
        report.rows.push(rpt);
        continue;
      }

      const stage = stageByPipelineAndSlug.get(`${pipeline.id}::${stageSlug}`);
      if (!stage) {
        rpt.errors.push(`Unknown stage_slug "${stageSlug}" in pipeline "${pipelineSlug}"`);
        report.deals.errors++;
        report.rows.push(rpt);
        continue;
      }

      let ownerUserId: string | null = null;
      const ownerEmail = (row['owner_email'] ?? '').toLowerCase();
      if (ownerEmail) {
        const u = userByEmail.get(ownerEmail);
        if (u) ownerUserId = u.id;
        else rpt.warnings.push(`Owner not found: "${ownerEmail}" — deal will have no owner`);
      }

      // Dynamic property columns
      const propUpdates: Record<string, string> = {};
      for (const [col, val] of Object.entries(row)) {
        if (!coreDealKeys.has(col) && val && propDefByKey.has(col)) {
          propUpdates[col] = val;
        }
      }

      if (!dryRun) {
        // Upsert on externalId
        const [existing] = await app.db
          .select()
          .from(deals)
          .where(eq(deals.externalId, externalId))
          .limit(1);

        let dealId: string;
        if (existing) {
          const updates: Record<string, any> = { stageId: stage.id, updatedAt: new Date() };
          if (ownerUserId !== null) updates['ownerUserId'] = ownerUserId;
          updates['isClosedWon'] = stage.isClosedWon;
          updates['isClosedLost'] = stage.isClosedLost;
          await app.db.update(deals).set(updates).where(eq(deals.id, existing.id));
          dealId = existing.id;
          rpt.action = 'update';
          report.deals.updated++;
        } else {
          const [created] = await app.db
            .insert(deals)
            .values({
              pipelineId: pipeline.id,
              stageId: stage.id,
              ownerUserId,
              externalId,
              isClosedWon: stage.isClosedWon,
              isClosedLost: stage.isClosedLost,
              createdByUserId: req.user!.id,
            })
            .returning({ id: deals.id });
          dealId = created!.id;

          // Stage event
          await app.db.insert(dealStageEvents).values({
            dealId,
            pipelineId: pipeline.id,
            fromStageId: null,
            toStageId: stage.id,
            changedByUserId: req.user!.id,
            source: 'import',
          });

          rpt.action = 'create';
          report.deals.created++;
        }

        // Property values
        for (const [key, val] of Object.entries(propUpdates)) {
          const pd = propDefByKey.get(key)!;
          await app.db
            .insert(dealPropertyValues)
            .values({ dealId, propertyDefinitionId: pd.id, value: val })
            .onConflictDoUpdate({
              target: [dealPropertyValues.dealId, dealPropertyValues.propertyDefinitionId],
              set: { value: val, updatedAt: new Date() },
            });
        }

        externalIdToDbId.set(externalId, dealId);
      } else {
        const [existing] = await app.db
          .select({ id: deals.id })
          .from(deals)
          .where(eq(deals.externalId, externalId))
          .limit(1);
        rpt.action = existing ? 'update' : 'create';
        if (existing) {
          report.deals.updated++;
          externalIdToDbId.set(externalId, existing.id);
        } else {
          report.deals.created++;
        }
      }

      report.rows.push(rpt);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DEAL_CONTACTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report.dealContacts.total = dealContactRows.length;
    for (let i = 0; i < dealContactRows.length; i++) {
      const row = dealContactRows[i]!;
      const rpt: ImportRow = { rowIndex: i + 2, sheet: 'deal_contacts', errors: [], warnings: [], action: null };

      const externalId = row['deal_external_id'] ?? '';
      const rawPhone = row['phone'] ?? row['phone_e164'] ?? '';

      if (!externalId) { rpt.errors.push('Missing: deal_external_id'); }
      if (!rawPhone) { rpt.errors.push('Missing: phone'); }

      if (rpt.errors.length > 0) {
        report.dealContacts.errors++;
        report.rows.push(rpt);
        continue;
      }

      const phoneE164 = normalizePhone(rawPhone);
      if (!phoneE164) {
        rpt.errors.push(`Invalid phone: "${rawPhone}"`);
        report.dealContacts.errors++;
        report.rows.push(rpt);
        continue;
      }

      // Resolve IDs (from this import batch OR DB)
      let dealId = externalIdToDbId.get(externalId);
      if (!dealId) {
        const [d] = await app.db
          .select({ id: deals.id })
          .from(deals)
          .where(eq(deals.externalId, externalId))
          .limit(1);
        if (!d) {
          rpt.errors.push(`Deal not found: external_id="${externalId}"`);
          report.dealContacts.errors++;
          report.rows.push(rpt);
          continue;
        }
        dealId = d.id;
      }

      let contactId = phoneToContactId.get(phoneE164);
      if (!contactId) {
        const [c] = await app.db
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.phoneE164, phoneE164))
          .limit(1);
        if (!c) {
          rpt.errors.push(`Contact not found: phone="${rawPhone}"`);
          report.dealContacts.errors++;
          report.rows.push(rpt);
          continue;
        }
        contactId = c.id;
      }

      const isPrimary = row['is_primary'] === 'true' || row['is_primary'] === '1';
      const role = row['role'] || null;

      if (!dryRun) {
        await app.db
          .insert(dealContacts)
          .values({ dealId, contactId, isPrimary, role })
          .onConflictDoNothing();
        rpt.action = 'create';
        report.dealContacts.linked++;
      } else {
        const [existing] = await app.db
          .select()
          .from(dealContacts)
          .where(and(eq(dealContacts.dealId, dealId), eq(dealContacts.contactId, contactId)))
          .limit(1);
        rpt.action = existing ? 'skip' : 'create';
        if (existing) report.dealContacts.skipped++;
        else report.dealContacts.linked++;
      }

      report.rows.push(rpt);
    }

    return report;
  });
}
