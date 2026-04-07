import { workflowSchedules } from '@crm/db';
import type { FastifyInstance } from 'fastify';

type Db = FastifyInstance['db'];

export interface WaitConfig {
  durationMinutes?: number;
  durationHours?: number;
  durationDays?: number;
}

export async function executeWait(
  db: Db,
  runId: string,
  config: WaitConfig,
): Promise<Date> {
  let totalMs = 0;
  if (config.durationMinutes) totalMs += config.durationMinutes * 60 * 1000;
  if (config.durationHours) totalMs += config.durationHours * 60 * 60 * 1000;
  if (config.durationDays) totalMs += config.durationDays * 24 * 60 * 60 * 1000;

  // Default to 1 hour if nothing specified
  if (totalMs === 0) totalMs = 60 * 60 * 1000;

  const resumeAt = new Date(Date.now() + totalMs);

  await db.insert(workflowSchedules).values({
    runId,
    resumeAt,
  });

  return resumeAt;
}
