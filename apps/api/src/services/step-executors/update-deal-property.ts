import { deals } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

type Db = FastifyInstance['db'];

export interface UpdateDealPropertyConfig {
  propertyKey: 'owner_user_id';
  value: string | null;
}

export async function executeUpdateDealProperty(
  db: Db,
  dealId: string | null | undefined,
  config: UpdateDealPropertyConfig,
): Promise<void> {
  if (!dealId) throw new Error('update_deal_property: no dealId on run');

  if (config.propertyKey === 'owner_user_id') {
    await db
      .update(deals)
      .set({ ownerUserId: config.value ?? null, updatedAt: new Date() })
      .where(eq(deals.id, dealId));
    return;
  }

  throw new Error(`update_deal_property: unsupported propertyKey "${config.propertyKey}"`);
}
