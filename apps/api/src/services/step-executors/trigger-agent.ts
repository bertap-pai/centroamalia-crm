import type { WorkflowRun } from '@crm/db';
import type { MergeContext } from '../workflow-merge-tags.js';
import { resolveMergeTags } from '../workflow-merge-tags.js';

export interface TriggerAgentConfig {
  agentId: string;      // Paperclip agent ID to assign the task to
  taskTitle: string;    // task title template, supports merge tags
  message: string;      // task description template, supports merge tags
}

export async function executeTriggerAgent(
  _run: WorkflowRun,
  config: TriggerAgentConfig,
  mergeContext: MergeContext,
): Promise<void> {
  if (!config.agentId) throw new Error('trigger_agent: agentId is required');
  if (!config.taskTitle) throw new Error('trigger_agent: taskTitle is required');

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !apiKey || !companyId) {
    throw new Error(
      'trigger_agent: PAPERCLIP_API_URL, PAPERCLIP_API_KEY, and PAPERCLIP_COMPANY_ID env vars must be set',
    );
  }

  const resolvedTitle = resolveMergeTags(config.taskTitle, mergeContext);
  const resolvedMessage = resolveMergeTags(config.message ?? '', mergeContext);

  const response = await fetch(`${apiUrl}/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      title: resolvedTitle,
      description: resolvedMessage,
      assigneeAgentId: config.agentId,
      status: 'todo',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`trigger_agent: Paperclip API returned ${response.status}: ${body.slice(0, 200)}`);
  }
}
