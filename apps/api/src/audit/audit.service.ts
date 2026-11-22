import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { canonicalJson, sha256 } from '../common/hash';

export const GENESIS_HASH = '0'.repeat(64);
// Arbitrary constant for the advisory lock that serialises the audit hash chain.
const AUDIT_LOCK_KEY = 7243001;

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  companyId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Tamper-evident audit trail. Each row's hash covers the previous row's hash plus its own canonical content,
 * so any edit/deletion (already blocked by DB trigger) is detectable by `verifyChain`.
 * Writes must happen inside the business transaction so audit and effect commit atomically.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
    const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS_HASH;
    const occurredAt = new Date();
    const data = (entry.data ?? {}) as Prisma.InputJsonValue;
    const hash = sha256(prevHash + canonicalJson(this.material({ ...entry, occurredAt })));
    await tx.auditLog.create({
      data: {
        occurredAt,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        companyId: entry.companyId ?? null,
        data,
        prevHash,
        hash,
      },
    });
  }

  private material(e: Omit<AuditEntry, 'data'> & { occurredAt: Date; data?: unknown }) {
    return {
      actorId: e.actorId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      companyId: e.companyId ?? null,
      data: e.data ?? {},
      occurredAt: e.occurredAt.toISOString(),
    };
  }

  /** Recompute the chain. Returns the first broken seq, or null if intact. */
  async verifyChain(batchSize = 1000): Promise<{ ok: boolean; checked: number; brokenAtSeq: string | null }> {
    let prev = GENESIS_HASH;
    let cursor: bigint | undefined;
    let checked = 0;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: cursor ? { seq: { gt: cursor } } : undefined,
        orderBy: { seq: 'asc' },
        take: batchSize,
      });
      if (!rows.length) break;
      for (const r of rows) {
        const expected = sha256(
          prev +
            canonicalJson(
              this.material({
                actorId: r.actorId,
                action: r.action,
                entityType: r.entityType,
                entityId: r.entityId,
                companyId: r.companyId,
                data: r.data,
                occurredAt: r.occurredAt,
              }),
            ),
        );
        if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAtSeq: r.seq.toString() };
        prev = r.hash;
        checked++;
        cursor = r.seq;
      }
    }
    return { ok: true, checked, brokenAtSeq: null };
  }

  list(entityType?: string, entityId?: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { seq: 'desc' },
      take,
    });
  }
}
