import { eq } from 'drizzle-orm';
import { contacts, contactPropertyValues, propertyDefinitions } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { resolveMergeTags, type MergeContext } from '../workflow-merge-tags.js';

type Db = FastifyInstance['db'];

export interface UpdateContactPropertyConfig {
  property: string;
  value: string;
}

export async function executeUpdateContactProperty(
  db: Db,
  contactId: string,
  config: UpdateContactPropertyConfig,
  mergeContext: MergeContext,
): Promise<void> {
  const resolvedValue = resolveMergeTags(config.value, mergeContext);

  // Check if this is a core contact field
  const coreFields: Record<string, string> = {
    first_name: 'firstName',
    last_name: 'lastName',
    email: 'email',
  };

  const coreField = coreFields[config.property];
  if (coreField) {
    await db
      .update(contacts)
      .set({ [coreField]: resolvedValue, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
    return;
  }

  // Dynamic property: find definition and upsert value
  const [propDef] = await db
    .select({ id: propertyDefinitions.id })
    .from(propertyDefinitions)
    .where(eq(propertyDefinitions.key, config.property))
    .limit(1);

  if (!propDef) {
    throw new Error(`Property definition not found: ${config.property}`);
  }

  await db
    .insert(contactPropertyValues)
    .values({
      contactId,
      propertyDefinitionId: propDef.id,
      value: resolvedValue,
    })
    .onConflictDoUpdate({
      target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
      set: { value: resolvedValue, updatedAt: new Date() },
    });
}
