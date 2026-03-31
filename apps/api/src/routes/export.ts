/**
 * GET /api/export
 * Query params:
 *   type        — 'contacts' | 'deals' | 'both' (default 'both')
 *   anonymous   — 'true' | 'false' (default false) — omit name, phone, email
 *   format      — 'xlsx' | 'csv' (default 'xlsx'; csv only valid when type != 'both')
 *   filter[key] — property filter (same syntax as contacts/deals list)
 *   includeArchived — 'true' | 'false' (default false)
 */

import type { FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import {
  contacts,
  deals,
  dealContacts,
  dealPropertyValues,
  contactPropertyValues,
  propertyDefinitions,
  pipelines,
  stages,
  users,
} from '@crm/db';

export default async function exportRoutes(app: FastifyInstance) {
  app.get('/api/export', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = req.query as Record<string, string>;

    const type = (q['type'] ?? 'both') as 'contacts' | 'deals' | 'both';
    const anonymous = q['anonymous'] === 'true';
    const format = (q['format'] ?? 'xlsx') as 'xlsx' | 'csv';
    const includeArchived = q['includeArchived'] === 'true';

    // Property filters
    const propFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      const m = k.match(/^filter\[(.+)\]$/);
      if (m?.[1]) propFilters[m[1]] = v;
    }

    // Load all property definitions once
    const allPropDefs = await app.db.select().from(propertyDefinitions);
    const propDefById = new Map(allPropDefs.map((d) => [d.id, d]));
    const propDefByKey = new Map(allPropDefs.map((d) => [d.key, d]));

    // ── Contacts ─────────────────────────────────────────────────────────────
    type ContactRow = Record<string, string>;
    let contactRows: ContactRow[] = [];

    if (type === 'contacts' || type === 'both') {
      const conditions: any[] = [];
      if (!includeArchived) conditions.push(isNull(contacts.archivedAt));

      for (const [key, val] of Object.entries(propFilters)) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM contact_property_values cpv
            JOIN property_definitions pd ON cpv.property_definition_id = pd.id
            WHERE cpv.contact_id = ${contacts.id} AND pd.key = ${key} AND cpv.value = ${val}
          )` as any,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await app.db.select().from(contacts).where(where).orderBy(contacts.createdAt);

      // Fetch all property values for these contacts
      const contactIds = rows.map((r) => r.id);
      const pvMap: Record<string, Record<string, string>> = {};
      if (contactIds.length > 0) {
        const pvRows = await app.db
          .select({
            contactId: contactPropertyValues.contactId,
            propId: contactPropertyValues.propertyDefinitionId,
            value: contactPropertyValues.value,
          })
          .from(contactPropertyValues)
          .where(inArray(contactPropertyValues.contactId, contactIds));
        for (const pv of pvRows) {
          if (!pvMap[pv.contactId]) pvMap[pv.contactId] = {};
          const pd = propDefById.get(pv.propId);
          if (pd) pvMap[pv.contactId]![pd.key] = pv.value ?? '';
        }
      }

      // Determine which property keys exist across all contacts (contact-scoped props)
      const contactPropDefs = allPropDefs.filter((d) => d.scope === 'contact' || d.scope === 'both');

      contactRows = rows.map((c) => {
        const row: ContactRow = {};
        row['id'] = c.id;
        if (!anonymous) {
          row['first_name'] = c.firstName ?? '';
          row['last_name'] = c.lastName ?? '';
          row['email'] = c.email ?? '';
          row['phone'] = c.phoneE164 ?? '';
        }
        row['created_at'] = c.createdAt.toISOString();
        for (const pd of contactPropDefs) {
          row[pd.key] = pvMap[c.id]?.[pd.key] ?? '';
        }
        return row;
      });
    }

    // ── Deals ─────────────────────────────────────────────────────────────────
    type DealRow = Record<string, string>;
    let dealRows: DealRow[] = [];

    if (type === 'deals' || type === 'both') {
      const conditions: any[] = [];
      if (!includeArchived) conditions.push(isNull(deals.archivedAt));

      for (const [key, val] of Object.entries(propFilters)) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM deal_property_values dpv
            JOIN property_definitions pd ON dpv.property_definition_id = pd.id
            WHERE dpv.deal_id = ${deals.id} AND pd.key = ${key} AND dpv.value = ${val}
          )` as any,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [allPipelines, allStages, allUsers, dealDbRows] = await Promise.all([
        app.db.select().from(pipelines),
        app.db.select().from(stages),
        app.db.select().from(users),
        app.db.select().from(deals).where(where).orderBy(deals.createdAt),
      ]);

      const pipelineById = new Map(allPipelines.map((p) => [p.id, p]));
      const stageById = new Map(allStages.map((s) => [s.id, s]));
      const userById = new Map(allUsers.map((u) => [u.id, u]));

      const dealIds = dealDbRows.map((d) => d.id);

      // Fetch property values
      const dpvMap: Record<string, Record<string, string>> = {};
      if (dealIds.length > 0) {
        const dpvRows = await app.db
          .select({
            dealId: dealPropertyValues.dealId,
            propId: dealPropertyValues.propertyDefinitionId,
            value: dealPropertyValues.value,
          })
          .from(dealPropertyValues)
          .where(inArray(dealPropertyValues.dealId, dealIds));
        for (const dpv of dpvRows) {
          if (!dpvMap[dpv.dealId]) dpvMap[dpv.dealId] = {};
          const pd = propDefById.get(dpv.propId);
          if (pd) dpvMap[dpv.dealId]![pd.key] = dpv.value ?? '';
        }
      }

      // Fetch primary contacts for deals
      type PrimaryContactInfo = { firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
      const primaryContactByDeal: Record<string, PrimaryContactInfo> = {};
      if (dealIds.length > 0 && !anonymous) {
        const dcRows = await app.db
          .select({
            dealId: dealContacts.dealId,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phoneE164,
          })
          .from(dealContacts)
          .innerJoin(contacts, eq(dealContacts.contactId, contacts.id))
          .where(and(inArray(dealContacts.dealId, dealIds), eq(dealContacts.isPrimary, true)));
        for (const dc of dcRows) {
          primaryContactByDeal[dc.dealId] = {
            firstName: dc.firstName,
            lastName: dc.lastName,
            email: dc.email,
            phone: dc.phone,
          };
        }
      }

      const dealPropDefs = allPropDefs.filter((d) => d.scope === 'deal' || d.scope === 'both');

      dealRows = dealDbRows.map((d) => {
        const row: DealRow = {};
        row['id'] = d.id;
        row['external_id'] = d.externalId ?? '';
        row['pipeline'] = pipelineById.get(d.pipelineId)?.name ?? '';
        row['stage'] = stageById.get(d.stageId)?.name ?? '';
        row['owner_email'] = d.ownerUserId ? (userById.get(d.ownerUserId)?.email ?? '') : '';
        row['is_closed_won'] = d.isClosedWon ? 'true' : 'false';
        row['is_closed_lost'] = d.isClosedLost ? 'true' : 'false';
        if (!anonymous) {
          const pc = primaryContactByDeal[d.id];
          row['primary_contact_first_name'] = pc?.firstName ?? '';
          row['primary_contact_last_name'] = pc?.lastName ?? '';
          row['primary_contact_email'] = pc?.email ?? '';
          row['primary_contact_phone'] = pc?.phone ?? '';
        }
        row['created_at'] = d.createdAt.toISOString();
        for (const pd of dealPropDefs) {
          row[pd.key] = dpvMap[d.id]?.[pd.key] ?? '';
        }
        return row;
      });
    }

    // ── Build output ──────────────────────────────────────────────────────────
    const filename = `export-${type}-${anonymous ? 'anon-' : ''}${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const data = type === 'deals' ? dealRows : contactRows;
      const ws = XLSX.utils.json_to_sheet(data);
      const csv = XLSX.utils.sheet_to_csv(ws);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return reply.send(csv);
    }

    // XLSX
    const wb = XLSX.utils.book_new();
    if (contactRows.length > 0 || type === 'contacts') {
      const ws = XLSX.utils.json_to_sheet(contactRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Contactes');
    }
    if (dealRows.length > 0 || type === 'deals') {
      const ws = XLSX.utils.json_to_sheet(dealRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Deals');
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return reply.send(buf);
  });
}
