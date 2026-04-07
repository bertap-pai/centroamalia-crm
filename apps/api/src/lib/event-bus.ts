import { EventEmitter } from 'node:events';

// ── Typed CRM event definitions ────────────────────────────────────────

export interface CrmEventMap {
  'contact.created': { contactId: string; userId?: string };
  'contact.updated': {
    contactId: string;
    userId?: string;
    changes: Record<string, { old: unknown; new: unknown }>;
  };
  'contact.deleted': { contactId: string; userId?: string };
  'deal.created': { dealId: string; contactId?: string; userId?: string };
  'deal.stage_changed': {
    dealId: string;
    contactId?: string;
    pipelineId: string;
    fromStageId: string | null;
    toStageId: string;
    userId?: string;
  };
  'form.submitted': {
    formId: string;
    formName: string;
    submissionId: string;
    contactId: string;
    data: Record<string, string>;
  };
  'task.completed': {
    taskId: string;
    contactId?: string;
    dealId?: string;
    userId?: string;
  };
  'meeting.scheduled': {
    meetingId: string;
    contactId: string;
    userId?: string;
  };
  'property.changed': {
    contactId: string;
    userId?: string;
    property: string;
    oldValue: unknown;
    newValue: unknown;
  };
}

export type CrmEventType = keyof CrmEventMap;

// ── Singleton event bus ────────────────────────────────────────────────

class CrmEventBus {
  private emitter = new EventEmitter();
  private propertyChangeBuffer = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; events: CrmEventMap['property.changed'][] }
  >();

  on<E extends CrmEventType>(event: E, listener: (payload: CrmEventMap[E]) => void): this {
    this.emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  off<E extends CrmEventType>(event: E, listener: (payload: CrmEventMap[E]) => void): this {
    this.emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  emit<E extends CrmEventType>(event: E, payload: CrmEventMap[E]): void {
    if (event === 'property.changed') {
      this.bufferPropertyChange(payload as CrmEventMap['property.changed']);
      return;
    }
    this.emitter.emit(event, payload);
  }

  private bufferPropertyChange(payload: CrmEventMap['property.changed']): void {
    const key = payload.contactId;
    const existing = this.propertyChangeBuffer.get(key);

    if (existing) {
      existing.events.push(payload);
    } else {
      const entry = {
        timer: setTimeout(() => this.flushPropertyChanges(key), 500),
        events: [payload],
      };
      this.propertyChangeBuffer.set(key, entry);
    }
  }

  private flushPropertyChanges(contactId: string): void {
    const entry = this.propertyChangeBuffer.get(contactId);
    if (!entry) return;
    this.propertyChangeBuffer.delete(contactId);

    for (const event of entry.events) {
      this.emitter.emit('property.changed', event);
    }
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
    for (const entry of this.propertyChangeBuffer.values()) {
      clearTimeout(entry.timer);
    }
    this.propertyChangeBuffer.clear();
  }
}

export const eventBus = new CrmEventBus();
