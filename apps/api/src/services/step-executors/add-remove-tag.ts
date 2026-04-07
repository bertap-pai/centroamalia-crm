import { eq, and } from 'drizzle-orm';
import { contactTags } from '@crm/db';
import type { FastifyInstance } from 'fastify';

type Db = FastifyInstance['db'];

export interface TagConfig {
  tag: string;
}

export async function executeAddTag(
  db: Db,
  contactId: string,
  config: TagConfig,
): Promise<void> {
  await db
    .insert(contactTags)
    .values({ contactId, tag: config.tag })
    .onConflictDoNothing();
}

export async function executeRemoveTag(
  db: Db,
  contactId: string,
  config: TagConfig,
): Promise<void> {
  await db
    .delete(contactTags)
    .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tag, config.tag)));
}
