import { workflowSchedules } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import type { FilterGroup } from '@crm/db';

type Db = FastifyInstance['db'];

export interface WaitUntilConfig {
  condition: FilterGroup;
  timeoutDays: number;
  checkIntervalMinutes?: number; // default 60
}

export async function executeWaitUntil(
  db: Db,
  runId: string,
  config: WaitUntilConfig,
): Promise<Date> {
  const intervalMs = (config.checkIntervalMinutes ?? 60) * 60 * 1000;
  const resumeAt = new Date(Date.now() + intervalMs);
  const timeoutAt = new Date(Date.now() + config.timeoutDays * 24 * 60 * 60 * 1000);

  await db.insert(workflowSchedules).values({
    runId,
    resumeAt,
    condition: config.condition,
    timeoutAt,
  });

  return resumeAt;
}
