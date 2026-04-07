import { deals, dealContacts, dealStageEvents } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { eventBus } from '../../lib/event-bus.js';

type Db = FastifyInstance['db'];

export interface CreateDealConfig {
  pipelineId: string;
  stageId: string;
}

export async function executeCreateDeal(
  db: Db,
  contactId: string,
  config: CreateDealConfig,
): Promise<string> {
  const now = new Date();

  const [deal] = await db
    .insert(deals)
    .values({
      pipelineId: config.pipelineId,
      stageId: config.stageId,
      currentStageEnteredAt: now,
    })
    .returning();

  if (!deal) throw new Error('Failed to insert deal');

  await db.insert(dealContacts).values({
    dealId: deal.id,
    contactId,
    isPrimary: true,
    role: null,
  });

  await db.insert(dealStageEvents).values({
    dealId: deal.id,
    pipelineId: config.pipelineId,
    fromStageId: null,
    toStageId: config.stageId,
    changedAt: now,
    source: 'api',
  });

  // Emit deal.created so other workflows can react
  eventBus.emit('deal.created', { dealId: deal.id, contactId });

  return deal.id;
}
