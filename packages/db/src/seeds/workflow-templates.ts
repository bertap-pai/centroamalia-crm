import type { Db } from '../index.js';
import { workflows, workflowSteps } from '../schema/workflows.js';

interface WorkflowTemplate {
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  enrollmentMode: string;
  filters: unknown;
  steps: Array<{ type: string; config: Record<string, unknown> }>;
}

const templates: WorkflowTemplate[] = [
  // WF-01: New Contact Welcome
  {
    name: 'WF-01: New Contact Welcome',
    description: 'Sends a welcome notification and tags new contacts.',
    triggerType: 'contact_created',
    triggerConfig: {},
    enrollmentMode: 'once',
    filters: null,
    steps: [
      { type: 'add_tag', config: { tag: 'new-contact' } },
      {
        type: 'send_internal_notification',
        config: {
          userId: '{{user.id}}',
          title: 'New contact: {{contact.first_name}} {{contact.last_name}}',
          body: 'A new contact has been created.',
          priority: 'normal',
        },
      },
    ],
  },

  // WF-02: Form Submission Follow-Up
  {
    name: 'WF-02: Form Submission Follow-Up',
    description: 'Creates a follow-up task when a form is submitted.',
    triggerType: 'form_submitted',
    triggerConfig: {},
    enrollmentMode: 'every_time',
    filters: null,
    steps: [
      { type: 'add_tag', config: { tag: 'form-submitted' } },
      {
        type: 'create_task',
        config: {
          title: 'Follow up on form submission from {{contact.first_name}}',
          dueInDays: 1,
          objectType: 'contact',
        },
      },
    ],
  },

  // WF-03: Deal Stage Change Notification
  {
    name: 'WF-03: Deal Stage Change Notification',
    description: 'Notifies team when a deal changes stage.',
    triggerType: 'deal_stage_changed',
    triggerConfig: {},
    enrollmentMode: 'every_time',
    filters: null,
    steps: [
      {
        type: 'send_internal_notification',
        config: {
          userId: '{{user.id}}',
          title: 'Deal moved to new stage',
          body: 'Contact {{contact.first_name}} {{contact.last_name}} deal has been updated.',
          priority: 'normal',
        },
      },
    ],
  },

  // WF-04: Task Completion Cleanup
  {
    name: 'WF-04: Task Completion Cleanup',
    description: 'Updates contact property and removes tag when a task is completed.',
    triggerType: 'task_completed',
    triggerConfig: {},
    enrollmentMode: 'every_time',
    filters: null,
    steps: [
      { type: 'remove_tag', config: { tag: 'pending-task' } },
      {
        type: 'update_contact_property',
        config: {
          property: 'last_task_completed_at',
          value: '{{trigger.completed_at | date:yyyy-MM-dd}}',
        },
      },
    ],
  },

  // WF-05: Contact Property Changed — Re-engagement
  {
    name: 'WF-05: Contact Re-engagement',
    description: 'Waits 3 days then creates a follow-up task when contact email changes.',
    triggerType: 'property_changed',
    triggerConfig: { property: 'email' },
    enrollmentMode: 'once',
    filters: null,
    steps: [
      { type: 'wait', config: { durationDays: 3 } },
      {
        type: 'create_task',
        config: {
          title: 'Re-engage {{contact.first_name}} — email updated',
          dueInDays: 2,
          objectType: 'contact',
        },
      },
    ],
  },

  // WF-06: Webhook on New Deal
  {
    name: 'WF-06: External Webhook on New Deal',
    description: 'Sends a webhook to an external system when a deal is created.',
    triggerType: 'deal_created',
    triggerConfig: {},
    enrollmentMode: 'every_time',
    filters: null,
    steps: [
      {
        type: 'webhook',
        config: {
          url: 'https://example.com/webhook/new-deal',
          method: 'POST',
          body: {
            event: 'deal_created',
            contact_name: '{{contact.first_name}} {{contact.last_name}}',
            deal_id: '{{deal.id}}',
          },
        },
      },
    ],
  },

  // WF-07: Multi-Step Onboarding
  {
    name: 'WF-07: Multi-Step Onboarding',
    description: 'Tags contact, notifies team, waits 1 day, then creates onboarding task.',
    triggerType: 'contact_created',
    triggerConfig: {},
    enrollmentMode: 'once',
    filters: null,
    steps: [
      { type: 'add_tag', config: { tag: 'onboarding' } },
      {
        type: 'send_internal_notification',
        config: {
          userId: '{{user.id}}',
          title: 'New onboarding: {{contact.first_name}} {{contact.last_name}}',
          body: 'A new contact requires onboarding.',
          priority: 'high',
        },
      },
      { type: 'wait', config: { durationDays: 1 } },
      {
        type: 'create_task',
        config: {
          title: 'Complete onboarding for {{contact.first_name}}',
          dueInDays: 3,
          objectType: 'contact',
        },
      },
    ],
  },
];

export async function seedWorkflowTemplates(db: Db): Promise<void> {
  for (const template of templates) {
    const [wf] = await db
      .insert(workflows)
      .values({
        name: template.name,
        description: template.description,
        triggerType: template.triggerType as any,
        triggerConfig: template.triggerConfig,
        enrollmentMode: template.enrollmentMode as any,
        filters: template.filters as any,
        status: 'draft',
      })
      .returning();

    if (!wf) continue;

    if (template.steps.length > 0) {
      await db.insert(workflowSteps).values(
        template.steps.map((s, i) => ({
          workflowId: wf.id,
          order: i,
          type: s.type as any,
          config: s.config,
        })),
      );
    }
  }
}
