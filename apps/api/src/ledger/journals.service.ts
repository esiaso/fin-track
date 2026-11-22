import { Injectable } from '@nestjs/common';
import { Journal, JournalLine, JournalSource, Prisma } from '@prisma/client';
import { d, Permission, toStorage } from '@fintrack/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { DomainError, Forbidden, NotFound, fromDbError, isUniqueViolation } from '../common/errors';
import { canonicalJson, sha256 } from '../common/hash';
import { AuthUser } from '../auth/auth.types';
import { assertScope } from '../auth/scope';
import { checkBalance } from './balance';
import { PeriodsService } from './periods.service';

export interface LineInput {
  accountId: string;
  currency: string;
  debit: string;
  credit: string;
  fxRate?: string;
  facilityId?: string | null;
  departmentId?: string | null;
  description?: string | null;
  dimensions?: Record<string, unknown>;
}

export interface JournalInput {
  companyId: string;
  facilityId?: string | null;
  journalDate: string; // YYYY-MM-DD
  description: string;
  lines: LineInput[];
  idempotencyKey: string;
  source?: JournalSource;
  sourceEntityType?: string;
  sourceEntityId?: string;
  sourceVersion?: number;
  sourceEventId?: string;
  correlationId?: string;
  /** Only sub-ledger / integration postings may hit control accounts. */
  allowControlAccounts?: boolean;
  reversalOfId?: string;
}

export type JournalWithLines = Journal & { lines: JournalLine[] };

/**
 * General-ledger journal lifecycle: DRAFT -> VALIDATED -> APPROVED -> POSTED (-> REVERSED).
 * Posted journals are immutable; corrections are reversal journals. The DB triggers re-check every rule at commit.
 */
@Injectable()
export class JournalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: PeriodsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ───────────── manual (maker-checker) flow ─────────────

  async createManual(user: AuthUser, dto: Omit<JournalInput, 'source' | 'allowControlAccounts'>): Promise<{ journal: JournalWithLines; created: boolean }> {
    assertScope(user, Permission.JOURNAL_CREATE, dto.companyId, dto.facilityId);
    return this.prisma.tx(async (tx) => {
      const res = await this.createDraft(tx, user.id, { ...dto, source: 'MANUAL', allowControlAccounts: false });
      if (res.created) {
        await this.audit.record(tx, { actorId: user.id, action: 'JOURNAL_CREATED', entityType: 'journal', entityId: res.journal.id, companyId: dto.companyId });
      }
      return res;
    });
  }

  async validate(user: AuthUser, id: string): Promise<JournalWithLines> {
    return this.mutate(id, async (tx, j) => {
      assertScope(user, Permission.JOURNAL_CREATE, j.companyId, j.facilityId);
      this.expectStatus(j, 'DRAFT');
      this.assertBalanced(j.lines);
      await this.periods.assertOpen(tx, j.periodId);
      await this.audit.record(tx, { actorId: user.id, action: 'JOURNAL_VALIDATED', entityType: 'journal', entityId: j.id, companyId: j.companyId });
      return tx.journal.update({ where: { id }, data: { status: 'VALIDATED', validatedAt: new Date() }, include: { lines: true } });
    });
  }

  async approve(user: AuthUser, id: string): Promise<JournalWithLines> {
    return this.mutate(id, async (tx, j) => {
      assertScope(user, Permission.JOURNAL_APPROVE, j.companyId, j.facilityId);
      this.expectStatus(j, 'VALIDATED');
      if (j.createdBy === user.id) throw new DomainError('SOD_VIOLATION', 'Maker cannot approve their own journal', 403);
      await this.assertApprovalLimit(tx, user, j);
      await this.audit.record(tx, { actorId: user.id, action: 'JOURNAL_APPROVED', entityType: 'journal', entityId: j.id, companyId: j.companyId });
      return tx.journal.update({ where: { id }, data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date() }, include: { lines: true } });
    });
  }

  async post(user: AuthUser, id: string): Promise<JournalWithLines> {
    return this.mutate(id, async (tx, j) => {
      assertScope(user, Permission.JOURNAL_POST, j.companyId, j.facilityId);
      this.expectStatus(j, 'APPROVED');
      if (j.createdBy === user.id) throw new DomainError('SOD_VIOLATION', 'Maker cannot post their own journal', 403);
      return this.doPost(tx, j, user.id);
    });
  }

  async reverse(user: AuthUser, id: string, reason: string, reversalDate?: string): Promise<JournalWithLines> {
    return this.mutate(id, async (tx, j) => {
      assertScope(user, Permission.JOURNAL_REVERSE, j.companyId, j.facilityId);
      return this.reverseInTx(tx, j, user.id, reason, reversalDate);
    });
  }

  // ───────────── system (integration / sub-ledger) flow ─────────────

  /**
   * Create + post in one step inside the caller's transaction. Used by integration consumers and sub-ledgers whose
   * documents were already approved upstream (assumption A-POST-01). Idempotent on (companyId, idempotencyKey).
   */
  async postSystemJournal(tx: Tx, actorId: string, input: JournalInput): Promise<{ journal: JournalWithLines; created: boolean }> {
    const res = await this.createDraft(tx, actorId, { ...input, allowControlAccounts: input.allowControlAccounts ?? true });
    if (!res.created) return res;
    const j = res.journal;
    this.assertBalanced(j.lines);
    await this.periods.assertOpen(tx, j.periodId);
    const now = new Date();
    await tx.journal.update({ where: { id: j.id }, data: { status: 'APPROVED', validatedAt: now, approvedBy: actorId, approvedAt: now } });
    const posted = await this.doPost(tx, { ...j, status: 'APPROVED' }, actorId);
    return { journal: posted, created: true };
  }

  async reverseInTx(tx: Tx, j: JournalWithLines, actorId: string, reason: string, reversalDate?: string): Promise<JournalWithLines> {
    this.expectStatus(j, 'POSTED');
    const date = reversalDate ?? (await this.defaultReversalDate(tx, j));
    const rev = await this.createDraft(tx, actorId, {
      companyId: j.companyId,
      facilityId: j.facilityId,
      journalDate: date,
      description: `Reversal of ${j.journalNo}: ${reason}`,
      idempotencyKey: `REV:${j.id}`,
      source: 'FINTRACK',
      sourceEntityType: 'journal',
      sourceEntityId: j.id,
      correlationId: j.correlationId ?? undefined,
      allowControlAccounts: true,
      reversalOfId: j.id,
      lines: j.lines
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((l) => ({
          accountId: l.accountId,
          currency: l.currency,
          debit: l.credit.toString(),
          credit: l.debit.toString(),
          fxRate: l.fxRate.toString(),
          facilityId: l.facilityId,
          departmentId: l.departmentId,
          description: l.description,
          dimensions: { ...(l.dimensions as Record<string, unknown>), reversesLineId: l.id },
        })),
    });
    await this.periods.assertOpen(tx, rev.journal.periodId);
    const now = new Date();
    await tx.journal.update({ where: { id: rev.journal.id }, data: { status: 'APPROVED', validatedAt: now, approvedBy: actorId, approvedAt: now } });
    const posted = await this.doPost(tx, { ...rev.journal, status: 'APPROVED' }, actorId);
    await tx.journal.update({ where: { id: j.id }, data: { status: 'REVERSED', reversedAt: now } });
    await this.audit.record(tx, {
      actorId,
      action: 'JOURNAL_REVERSED',
      entityType: 'journal',
      entityId: j.id,
      companyId: j.companyId,
      data: { reversalJournalId: posted.id, reason },
    });
    return posted;
  }

  // ───────────── queries ─────────────

  async get(user: AuthUser, id: string) {
    const j = await this.prisma.journal.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, name: true } } } }, sourceEvent: true },
    });
    if (!j) throw NotFound('Journal', id);
    assertScope(user, Permission.LEDGER_READ, j.companyId, j.facilityId);
    return j;
  }

  async list(user: AuthUser, q: { companyId: string; status?: string; from?: string; to?: string; take?: number; skip?: number }) {
    assertScope(user, Permission.LEDGER_READ, q.companyId);
    const where: Prisma.JournalWhereInput = {
      companyId: q.companyId,
      status: q.status as Journal['status'] | undefined,
      journalDate: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.journal.findMany({ where, orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }], take: Math.min(q.take ?? 50, 200), skip: q.skip ?? 0 }),
      this.prisma.journal.count({ where }),
    ]);
    return { items, total };
  }

  // ───────────── internals ─────────────

  private async createDraft(tx: Tx, actorId: string, input: JournalInput): Promise<{ journal: JournalWithLines; created: boolean }> {
    const existing = await tx.journal.findUnique({
      where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
      include: { lines: true },
    });
    if (existing) return { journal: existing, created: false };

    const company = await tx.company.findUnique({ where: { id: input.companyId } });
    if (!company || !company.active) throw NotFound('Company', input.companyId);
    const period = await this.periods.findForDate(tx, input.companyId, input.journalDate);

    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const lines = input.lines.map((l, idx) => {
      const acct = byId.get(l.accountId);
      if (!acct || acct.companyId !== input.companyId) throw new DomainError('INVALID_ACCOUNT', `Line ${idx + 1}: account not in company`);
      if (!acct.isPostable || !acct.active) throw new DomainError('INVALID_ACCOUNT', `Line ${idx + 1}: account ${acct.code} is not postable`);
      if (acct.controlType !== 'NONE' && !input.allowControlAccounts) {
        throw new DomainError('CONTROL_ACCOUNT', `Line ${idx + 1}: ${acct.code} is a ${acct.controlType} control account; post via its sub-ledger`);
      }
      const currency = l.currency.toUpperCase();
      if (acct.currency && acct.currency !== currency) throw new DomainError('CURRENCY_MISMATCH', `Line ${idx + 1}: account ${acct.code} only accepts ${acct.currency}`);
      let fx = d(l.fxRate ?? '1');
      if (currency === company.baseCurrency) fx = d(1);
      else if (!l.fxRate) throw new DomainError('FX_REQUIRED', `Line ${idx + 1}: fxRate required for ${currency}`);
      return {
        lineNo: idx + 1,
        accountId: l.accountId,
        facilityId: l.facilityId ?? input.facilityId ?? null,
        departmentId: l.departmentId ?? null,
        currency,
        debit: toStorage(l.debit),
        credit: toStorage(l.credit),
        fxRate: fx.toFixed(10),
        baseDebit: toStorage(d(l.debit).mul(fx)),
        baseCredit: toStorage(d(l.credit).mul(fx)),
        description: l.description ?? null,
        dimensions: (l.dimensions ?? {}) as Prisma.InputJsonValue,
      };
    });
    const bal = checkBalance(lines);
    if (!bal.balanced) throw new DomainError('UNBALANCED', 'Journal does not balance', 422, bal);

    try {
      // Savepoint-free uniqueness: we rely on the unique index; on race we return the winner.
      const journal = await tx.journal.create({
        data: {
          companyId: input.companyId,
          facilityId: input.facilityId ?? null,
          journalDate: new Date(input.journalDate),
          periodId: period.id,
          description: input.description,
          source: input.source ?? 'MANUAL',
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          sourceVersion: input.sourceVersion,
          sourceEventId: input.sourceEventId,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          reversalOfId: input.reversalOfId,
          createdBy: actorId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      return { journal, created: true };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError('IDEMPOTENCY_RACE', 'Concurrent request with same idempotency key; retry', 409);
      }
      throw fromDbError(err) ?? err;
    }
  }

  private async doPost(tx: Tx, j: JournalWithLines, actorId: string): Promise<JournalWithLines> {
    await this.periods.assertOpen(tx, j.periodId); // FOR SHARE: a concurrent period close waits for this posting
    const journalNo = await this.nextNumber(tx, j.companyId, 'JOURNAL', 'JV');
    const postedAt = new Date();
    const contentHash = sha256(
      canonicalJson({
        id: j.id,
        companyId: j.companyId,
        journalNo,
        journalDate: j.journalDate.toISOString().slice(0, 10),
        lines: [...j.lines]
          .sort((a, b) => a.lineNo - b.lineNo)
          .map((l) => ({ n: l.lineNo, a: l.accountId, c: l.currency, dr: l.debit.toString(), cr: l.credit.toString(), bdr: l.baseDebit.toString(), bcr: l.baseCredit.toString() })),
      }),
    );
    let posted: JournalWithLines;
    try {
      posted = await tx.journal.update({
        where: { id: j.id },
        data: { status: 'POSTED', journalNo, postedBy: actorId, postedAt, contentHash },
        include: { lines: true },
      });
    } catch (err) {
      throw fromDbError(err) ?? err;
    }
    await this.audit.record(tx, { actorId, action: 'JOURNAL_POSTED', entityType: 'journal', entityId: j.id, companyId: j.companyId, data: { journalNo, contentHash } });
    await this.outbox.add(tx, {
      aggregateType: 'journal',
      aggregateId: j.id,
      eventType: 'fintrack.journal.posted',
      correlationId: j.correlationId,
      payload: { journalId: j.id, journalNo, companyId: j.companyId, journalDate: j.journalDate.toISOString().slice(0, 10), source: j.source, sourceEntityType: j.sourceEntityType, sourceEntityId: j.sourceEntityId },
    });
    return posted;
  }

  private async nextNumber(tx: Tx, companyId: string, docType: string, prefix: string): Promise<string> {
    await tx.documentSequence.upsert({ where: { companyId_docType: { companyId, docType } }, update: {}, create: { companyId, docType, prefix } });
    const rows = await tx.$queryRaw<{ next_value: number; prefix: string }[]>`
      UPDATE document_sequences SET next_value = next_value + 1
       WHERE company_id = ${companyId}::uuid AND doc_type = ${docType}
       RETURNING next_value - 1 AS next_value, prefix`;
    return `${rows[0].prefix}-${String(rows[0].next_value).padStart(8, '0')}`;
  }

  private async defaultReversalDate(tx: Tx, j: Journal): Promise<string> {
    const p = await tx.fiscalPeriod.findUnique({ where: { id: j.periodId } });
    if (p?.status === 'OPEN') return j.journalDate.toISOString().slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  }

  private async assertApprovalLimit(tx: Tx, user: AuthUser, j: JournalWithLines) {
    const limits = await tx.approvalLimit.findMany({ where: { companyId: j.companyId, docType: 'JOURNAL' } });
    if (!limits.length) return; // no limits configured for this company => role permission is sufficient (A-SEC-03)
    const total = j.lines.reduce((acc, l) => acc.plus(d(l.baseDebit.toString())), d(0));
    const userRoles = new Set(user.roles.map((r) => r.role));
    const ok = limits.some((l) => userRoles.has(l.role) && d(l.maxAmount.toString()).gte(total));
    if (!ok) throw Forbidden(`Journal total ${total.toFixed(2)} exceeds your approval limit`);
  }

  private assertBalanced(lines: JournalLine[]) {
    const bal = checkBalance(lines.map((l) => ({ currency: l.currency, debit: l.debit.toString(), credit: l.credit.toString(), baseDebit: l.baseDebit.toString(), baseCredit: l.baseCredit.toString() })));
    if (!bal.balanced) throw new DomainError('UNBALANCED', 'Journal does not balance', 422, bal);
  }

  private expectStatus(j: Journal, status: Journal['status']) {
    if (j.status !== status) throw new DomainError('INVALID_STATUS', `Journal is ${j.status}; expected ${status}`, 409);
  }

  /** Lock the journal row (SELECT ... FOR UPDATE) then run fn, all in one transaction. */
  private mutate<T>(id: string, fn: (tx: Tx, j: JournalWithLines) => Promise<T>): Promise<T> {
    return this.prisma.tx(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM journals WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked.length) throw NotFound('Journal', id);
      const j = await tx.journal.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      return fn(tx, j);
    });
  }
}
