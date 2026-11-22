import { InboxEvent } from '@prisma/client';
import { Tx } from '../../prisma/prisma.service';

export interface HandlerResult {
  traces: { targetType: string; targetId: string }[];
}

/** An integration consumer for one event_type. Runs inside the inbox processing transaction. */
export interface EventHandler {
  readonly eventType: string;
  handle(tx: Tx, event: InboxEvent): Promise<HandlerResult>;
}

export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');

/** Business errors that will not succeed on retry go straight to the dead-letter queue. */
export class NonRetryableError extends Error {}
