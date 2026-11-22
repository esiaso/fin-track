import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InboxEvent, InboxStatus, Prisma } from '@prisma/client';
import { IntegrationEventEnvelope, Permission } from '@fintrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Conflict, DomainError, NotFound } from '../common/errors';
import { canonicalJson, sha256 } from '../common/hash';
import { AuthUser } from '../auth/auth.types';
import { secretFor, verifySignature } from './signature';
import { EVENT_HANDLERS, EventHandler, NonRetryableError } from './handlers/handler';

export const INBOX_DISPATCHER = Symbol('INBOX_DISPATCHER');
export interface InboxDispatcher {
  dispatch(inboxId: string, delayMs?: number): Promise<void>;
}

export type IngestResult = { id: string; status: 'ACCEPTED' | 'DUPLICATE'; inboxStatus: InboxStatus };

/**
 * Idempotent event inbox.
 *  - ingest(): verify signature, validate envelope, persist once per (source_system, event_id). A replay with identical
 *    content returns DUPLICATE; reuse of an event_id with different content is rejected (409).
 *  - process(): claim with FOR UPDATE SKIP LOCKED, serialise per source entity with an advisory lock, skip versions already
 *    processed, run the handler and record traces + processed version in the SAME transaction as the postings.
 *  - Failures retry with exponential backoff and land in DEAD_LETTER after INBOX_MAX_ATTEMPTS (or immediately when non-retryable).
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  private readonly handlers: Map<string, EventHandler>;
  private readonly maxAttempts = Number(process.env.INBOX_MAX_ATTEMPTS ?? 5);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(EVENT_HANDLERS) handlers: EventHandler[],
    @Optional() @Inject(INBOX_DISPATCHER) private readonly dispatcher?: InboxDispatcher,
  ) {
    this.handlers = new Map(handlers.map((h) => [h.eventType, h]));
  }

  async ingest(rawBody: Buffer | string, headers: { timestamp?: string; signature?: string }): Promise<IngestResult> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString());
    } catch {
      throw new DomainError('BAD_JSON', 'Body is not valid JSON', 400);
    }
    const parsed = IntegrationEventEnvelope.safeParse(json);
    if (!parsed.success) throw new DomainError('INVALID_ENVELOPE', 'Envelope validation failed', 400, parsed.error.issues);
    const env = parsed.data;

    const sig = verifySignature({
      secret: secretFor(env.source_system),
      timestamp: headers.timestamp,
      signature: headers.signature,
      rawBody,
      maxSkewSeconds: Number(process.env.INTEGRATION_MAX_SKEW_SECONDS ?? 300),
    });
    if (!sig.ok) throw new DomainError('BAD_SIGNATURE', `Signature rejected: ${sig.reason}`, 401);

    const payloadHash = sha256(canonicalJson(env));
    const data: Prisma.InboxEventCreateInput = {
      sourceSystem: env.source_system,
      eventId: env.event_id,
      eventType: env.event_type,
      sourceEntityType: env.source_entity_type,
      sourceEntityId: env.source_entity_id,
      sourceVersion: env.source_version,
      occurredAt: new Date(env.occurred_at),
      facilityExtId: env.facility_id,
      correlationId: env.correlation_id,
      payload: env.payload as Prisma.InputJsonValue,
      payloadHash,
      signatureVerified: true,
    };

    // INSERT ... ON CONFLICT DO NOTHING keeps this race-free under concurrent redelivery.
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO inbox_events (id, source_system, event_id, event_type, source_entity_type, source_entity_id, source_version,
                                occurred_at, facility_ext_id, correlation_id, payload, payload_hash, signature_verified, status, attempts, received_at)
      VALUES (gen_random_uuid(), ${data.sourceSystem}, ${data.eventId}, ${data.eventType}, ${data.sourceEntityType}, ${data.sourceEntityId},
              ${data.sourceVersion}, ${data.occurredAt}, ${data.facilityExtId}, ${data.correlationId}, ${JSON.stringify(env.payload)}::jsonb,
              ${payloadHash}, true, 'RECEIVED', 0, now())
      ON CONFLICT (source_system, event_id) DO NOTHING
      RETURNING id`;

    if (inserted.length) {
      await this.dispatcher?.dispatch(inserted[0].id);
      return { id: inserted[0].id, status: 'ACCEPTED', inboxStatus: 'RECEIVED' };
    }
    const existing = await this.prisma.inboxEvent.findUniqueOrThrow({
      where: { sourceSystem_eventId: { sourceSystem: env.source_system, eventId: env.event_id } },
    });
    if (existing.payloadHash !== payloadHash) {
      throw Conflict('EVENT_ID_REUSED', `event_id ${env.event_id} was already received with different content`, { inboxId: existing.id });
    }
    return { id: existing.id, status: 'DUPLICATE', inboxStatus: existing.status };
  }

  /** Process one inbox event. Returns the resulting status. Safe to call concurrently and repeatedly. */
  async process(inboxId: string): Promise<InboxStatus | 'SKIPPED'> {
    try {
      return await this.prisma.tx(
        async (tx) => {
          const claimed = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM inbox_events
             WHERE id = ${inboxId}::uuid AND status IN ('RECEIVED','FAILED')
             FOR UPDATE SKIP LOCKED`;
          if (!claimed.length) return 'SKIPPED' as const;
          const ev = await tx.inboxEvent.findUniqueOrThrow({ where: { id: inboxId } });

          // Serialise all events for the same upstream entity (prevents concurrent v1/v2 races).
          const entityKey = `${ev.sourceSystem}|${ev.sourceEntityType}|${ev.sourceEntityId}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${entityKey}, 0))`;

          const seen = await tx.sourceEntityVersion.findFirst({
            where: { sourceSystem: ev.sourceSystem, sourceEntityType: ev.sourceEntityType, sourceEntityId: ev.sourceEntityId, sourceVersion: { gte: ev.sourceVersion } },
            orderBy: { sourceVersion: 'desc' },
          });
          if (seen) {
            const reason =
              seen.sourceVersion === ev.sourceVersion
                ? `version ${ev.sourceVersion} already processed by inbox event ${seen.inboxEventId}`
                : `stale: version ${seen.sourceVersion} already processed`;
            await tx.inboxEvent.update({ where: { id: ev.id }, data: { status: 'IGNORED_DUPLICATE', lastError: reason, processedAt: new Date() } });
            await this.audit.record(tx, { action: 'INBOX_IGNORED', entityType: 'inbox_event', entityId: ev.id, data: { reason } });
            return 'IGNORED_DUPLICATE' as const;
          }

          const handler = this.handlers.get(ev.eventType);
          if (!handler) throw new NonRetryableError(`No handler for event_type ${ev.eventType}`);

          const result = await handler.handle(tx, ev);
          await tx.sourceEntityVersion.create({
            data: { sourceSystem: ev.sourceSystem, sourceEntityType: ev.sourceEntityType, sourceEntityId: ev.sourceEntityId, sourceVersion: ev.sourceVersion, inboxEventId: ev.id },
          });
          if (result.traces.length) {
            await tx.postingTrace.createMany({ data: result.traces.map((t) => ({ inboxEventId: ev.id, ...t })), skipDuplicates: true });
          }
          await tx.inboxEvent.update({ where: { id: ev.id }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null, attempts: { increment: 1 } } });
          await this.audit.record(tx, { action: 'INBOX_PROCESSED', entityType: 'inbox_event', entityId: ev.id, data: { eventType: ev.eventType, traces: result.traces } });
          return 'PROCESSED' as const;
        },
        { timeout: 30000 },
      );
    } catch (err) {
      return this.recordFailure(inboxId, err);
    }
  }

  private async recordFailure(inboxId: string, err: unknown): Promise<InboxStatus> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const ev = await this.prisma.inboxEvent.findUnique({ where: { id: inboxId } });
    if (!ev) throw err;
    const attempts = ev.attempts + 1;
    const dead = err instanceof NonRetryableError || attempts >= this.maxAttempts;
    const delayMs = Math.min(2 ** attempts * 1000, 15 * 60 * 1000);
    const status: InboxStatus = dead ? 'DEAD_LETTER' : 'FAILED';
    await this.prisma.tx(async (tx) => {
      await tx.inboxEvent.update({
        where: { id: inboxId },
        data: { status, attempts, lastError: message, nextAttemptAt: dead ? null : new Date(Date.now() + delayMs) },
      });
      await this.audit.record(tx, { action: dead ? 'INBOX_DEAD_LETTERED' : 'INBOX_FAILED', entityType: 'inbox_event', entityId: inboxId, data: { attempts, error: message } });
    });
    this.logger.warn(`inbox ${inboxId} ${status} (attempt ${attempts}): ${message}`);
    if (!dead) await this.dispatcher?.dispatch(inboxId, delayMs);
    return status;
  }

  /** Re-queue events whose retry time has passed (sweeper; complements BullMQ delayed jobs). */
  async dueForRetry(limit = 100): Promise<string[]> {
    const rows = await this.prisma.inboxEvent.findMany({
      where: { OR: [{ status: 'RECEIVED', receivedAt: { lt: new Date(Date.now() - 60_000) } }, { status: 'FAILED', nextAttemptAt: { lte: new Date() } }] },
      select: { id: true },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  /** Manually replay a dead-lettered event after the cause (e.g. missing mapping) is fixed. */
  async replay(user: AuthUser, id: string) {
    if (!user.permissions.has(Permission.INTEGRATION_ADMIN)) throw new DomainError('FORBIDDEN', 'integration:admin required', 403);
    return this.prisma.tx(async (tx) => {
      const ev = await tx.inboxEvent.findUnique({ where: { id } });
      if (!ev) throw NotFound('Inbox event', id);
      if (ev.status !== 'DEAD_LETTER' && ev.status !== 'FAILED') throw new DomainError('INVALID_STATUS', `Only FAILED/DEAD_LETTER events can be replayed (is ${ev.status})`, 409);
      await tx.inboxEvent.update({ where: { id }, data: { status: 'RECEIVED', attempts: 0, nextAttemptAt: null } });
      await this.audit.record(tx, { actorId: user.id, action: 'INBOX_REPLAY_REQUESTED', entityType: 'inbox_event', entityId: id });
      return { id, status: 'RECEIVED' };
    }).then(async (r) => {
      await this.dispatcher?.dispatch(id);
      return r;
    });
  }

  list(q: { status?: InboxStatus; sourceSystem?: string; take?: number }): Promise<InboxEvent[]> {
    return this.prisma.inboxEvent.findMany({
      where: { status: q.status, sourceSystem: q.sourceSystem },
      orderBy: { receivedAt: 'desc' },
      take: Math.min(q.take ?? 50, 200),
    });
  }

  /** Upstream -> downstream: everything produced by an inbox event; downstream -> upstream: source of a journal. */
  async trace(q: { inboxId?: string; journalId?: string }) {
    if (q.inboxId) {
      const ev = await this.prisma.inboxEvent.findUnique({ where: { id: q.inboxId }, include: { traces: true } });
      if (!ev) throw NotFound('Inbox event', q.inboxId);
      return ev;
    }
    const traces = await this.prisma.postingTrace.findMany({ where: { targetType: 'JOURNAL', targetId: q.journalId }, include: { inboxEvent: true } });
    return traces.map((t) => t.inboxEvent);
  }
}
