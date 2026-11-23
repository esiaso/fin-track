import { Injectable } from '@nestjs/common';
import { FiscalPeriod, PeriodStatus } from '@prisma/client';
import { Permission } from '@fintrack/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DomainError, NotFound } from '../common/errors';
import { AuthUser } from '../auth/auth.types';
import { assertScope } from '../auth/scope';

/**
 * Financial period control. OPEN -> SOFT_CLOSED (reopenable by controller) -> LOCKED (final; A-PER-02).
 * Posting is only possible into OPEN periods; the DB trigger enforces the same at commit.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findForDate(tx: Tx, companyId: string, date: string): Promise<FiscalPeriod> {
    const day = new Date(date);
    const p = await tx.fiscalPeriod.findFirst({ where: { companyId, startDate: { lte: day }, endDate: { gte: day } } });
    if (!p) throw new DomainError('NO_PERIOD', `No fiscal period covers ${date}`);
    return p;
  }

  async assertOpen(tx: Tx, periodId: string): Promise<void> {
    // Share-lock the period row so a concurrent close/lock waits for in-flight postings (and vice versa).
    const rows = await tx.$queryRaw<{ status: PeriodStatus; code: string }[]>`
      SELECT status, code FROM fiscal_periods WHERE id = ${periodId}::uuid FOR SHARE`;
    if (!rows.length) throw NotFound('Period', periodId);
    if (rows[0].status !== 'OPEN') throw new DomainError('PERIOD_NOT_OPEN', `Period ${rows[0].code} is ${rows[0].status}`, 409);
  }

  list(user: AuthUser, companyId: string) {
    assertScope(user, Permission.LEDGER_READ, companyId);
    return this.prisma.fiscalPeriod.findMany({ where: { companyId }, orderBy: { startDate: 'asc' } });
  }

  async create(user: AuthUser, input: { companyId: string; code: string; startDate: string; endDate: string }) {
    assertScope(user, Permission.PERIOD_MANAGE, input.companyId);
    return this.prisma.tx(async (tx) => {
      const overlap = await tx.fiscalPeriod.findFirst({
        where: { companyId: input.companyId, startDate: { lte: new Date(input.endDate) }, endDate: { gte: new Date(input.startDate) } },
      });
      if (overlap) throw new DomainError('PERIOD_OVERLAP', `Overlaps period ${overlap.code}`, 409);
      const p = await tx.fiscalPeriod.create({
        data: { companyId: input.companyId, code: input.code, startDate: new Date(input.startDate), endDate: new Date(input.endDate) },
      });
      await this.audit.record(tx, { actorId: user.id, action: 'PERIOD_CREATED', entityType: 'fiscal_period', entityId: p.id, companyId: p.companyId });
      return p;
    });
  }

  async transition(user: AuthUser, id: string, to: PeriodStatus, reason?: string) {
    return this.prisma.tx(async (tx) => {
      // Exclusive lock: waits for any in-flight posting holding FOR SHARE on this period.
      const rows = await tx.$queryRaw<FiscalPeriod[]>`SELECT * FROM fiscal_periods WHERE id = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw NotFound('Period', id);
      const p = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id } });
      assertScope(user, Permission.PERIOD_MANAGE, p.companyId);
      const allowed: Record<PeriodStatus, PeriodStatus[]> = {
        OPEN: ['SOFT_CLOSED', 'LOCKED'],
        SOFT_CLOSED: ['OPEN', 'LOCKED'],
        LOCKED: [],
      };
      if (!allowed[p.status].includes(to)) throw new DomainError('INVALID_STATUS', `Cannot move period ${p.code} from ${p.status} to ${to}`, 409);
      if (to === 'OPEN' && !reason) throw new DomainError('REASON_REQUIRED', 'Reopening a period requires a reason');
      if (to === 'LOCKED') {
        const pending = await tx.journal.count({ where: { periodId: id, status: { in: ['DRAFT', 'VALIDATED', 'APPROVED'] } } });
        if (pending) throw new DomainError('PERIOD_HAS_PENDING', `${pending} unposted journal(s) remain in ${p.code}`, 409);
      }
      const updated = await tx.fiscalPeriod.update({
        where: { id },
        data: { status: to, closedBy: to === 'OPEN' ? null : user.id, closedAt: to === 'OPEN' ? null : new Date() },
      });
      await this.audit.record(tx, {
        actorId: user.id,
        action: `PERIOD_${to}`,
        entityType: 'fiscal_period',
        entityId: id,
        companyId: p.companyId,
        data: { from: p.status, to, reason: reason ?? null },
      });
      return updated;
    });
  }
}
