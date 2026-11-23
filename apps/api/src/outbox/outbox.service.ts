import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface OutboundPublisher {
  publish(event: { id: string; eventType: string; aggregateType: string; aggregateId: string; payload: unknown; correlationId: string | null }): Promise<void>;
}

export const OUTBOUND_PUBLISHER = Symbol('OUTBOUND_PUBLISHER');

/**
 * Transactional outbox: domain events are written in the same DB transaction as the state change,
 * then relayed asynchronously (at-least-once) by `relayBatch`. Consumers dedupe on event id.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  constructor(private readonly prisma: PrismaService) {}

  add(tx: Tx, e: { aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown>; correlationId?: string | null }) {
    return tx.outboxEvent.create({
      data: {
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        payload: e.payload as Prisma.InputJsonValue,
        correlationId: e.correlationId ?? null,
      },
    });
  }

  /** Claim and publish up to `limit` pending events. Safe to run concurrently (SKIP LOCKED). */
  async relayBatch(publisher: OutboundPublisher, limit = 50, maxAttempts = 10): Promise<number> {
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; event_type: string; aggregate_type: string; aggregate_id: string; payload: unknown; correlation_id: string | null; attempts: number }[]
      >`SELECT id, event_type, aggregate_type, aggregate_id, payload, correlation_id, attempts
          FROM outbox_events
         WHERE status IN ('PENDING','FAILED') AND available_at <= now()
         ORDER BY created_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        try {
          await publisher.publish({
            id: r.id,
            eventType: r.event_type,
            aggregateType: r.aggregate_type,
            aggregateId: r.aggregate_id,
            payload: r.payload,
            correlationId: r.correlation_id,
          });
          await tx.outboxEvent.update({ where: { id: r.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), attempts: { increment: 1 } } });
        } catch (err) {
          const attempts = r.attempts + 1;
          this.logger.warn(`outbox ${r.id} publish failed (attempt ${attempts}): ${(err as Error).message}`);
          await tx.outboxEvent.update({
            where: { id: r.id },
            data: {
              status: attempts >= maxAttempts ? 'DEAD_LETTER' : 'FAILED',
              attempts,
              lastError: (err as Error).message.slice(0, 2000),
              availableAt: new Date(Date.now() + Math.min(2 ** attempts, 3600) * 1000),
            },
          });
        }
      }
      return rows.length;
    });
  }
}
