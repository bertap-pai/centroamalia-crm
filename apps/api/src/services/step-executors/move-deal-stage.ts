import { deals, dealStageEvents } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { eventBus } from '../../lib/event-bus.js';

type Db = FastifyInstance['db'];

export interface MoveDealStageConfig {
  targetStageId: string;
}

export async function executeMoveDealStage(
  db: Db,
  dealId: string | null | undefined,
  config: MoveDealStageConfig,
): Promise<void> {
  if (!dealId) throw new Error('move_deal_stage: no dealId on run');

  const [existing] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!existing) throw new Error(`move_deal_stage: deal ${dealId} not found`);

  const now = new Date();

  await db
    .update(deals)
    .set({ stageId: config.targetStageId, currentStageEnteredAt: now, updatedAt: now })
    .where(eq(deals.id, dealId));

  await db.insert(dealStageEvents).values({
    dealId,
    pipelineId: existing.pipelineId,
    fromStageId: existing.stageId,
    toStageId: config.targetStageId,
    changedAt: now,
    source: 'api',
  });

  eventBus.emit('deal.stage_changed', {
    dealId,
    contactId: '',
    pipelineId: existing.pipelineId,
    fromStageId: existing.stageId,
    toStageId: config.targetStageId,
  });
}
