import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { d, Permission } from '@fintrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { assertScope } from '../auth/scope';

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  currency: string;
  debit: string;
  credit: string;
  balance: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trial balance for a company, optionally limited to one period, optionally by facility. Totals per currency. */
  async trialBalance(user: AuthUser, q: { companyId: string; periodId?: string; facilityId?: string }) {
    assertScope(user, Permission.REPORT_READ, q.companyId, q.facilityId);
    const rows = await this.prisma.$queryRaw<
      { account_id: string; account_code: string; account_name: string; account_type: string; currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]
    >`
      SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name, a.type::text AS account_type, l.currency,
             sum(l.debit) AS debit, sum(l.credit) AS credit
        FROM journal_lines l
        JOIN journals j ON j.id = l.journal_id
        JOIN accounts a ON a.id = l.account_id
       WHERE j.company_id = ${q.companyId}::uuid
         AND j.status IN ('POSTED','REVERSED')
         ${q.periodId ? Prisma.sql`AND j.period_id = ${q.periodId}::uuid` : Prisma.empty}
         ${q.facilityId ? Prisma.sql`AND l.facility_id = ${q.facilityId}::uuid` : Prisma.empty}
       GROUP BY a.id, a.code, a.name, a.type, l.currency
       ORDER BY a.code, l.currency`;
    const out: TrialBalanceRow[] = rows.map((r) => ({
      accountId: r.account_id,
      accountCode: r.account_code,
      accountName: r.account_name,
      accountType: r.account_type,
      currency: r.currency,
      debit: d(r.debit.toString()).toFixed(4),
      credit: d(r.credit.toString()).toFixed(4),
      balance: d(r.debit.toString()).minus(d(r.credit.toString())).toFixed(4),
    }));
    const totals = new Map<string, { debit: string; credit: string }>();
    for (const r of out) {
      const t = totals.get(r.currency) ?? { debit: '0', credit: '0' };
      totals.set(r.currency, { debit: d(t.debit).plus(d(r.debit)).toFixed(4), credit: d(t.credit).plus(d(r.credit)).toFixed(4) });
    }
    return {
      rows: out,
      totals: [...totals.entries()].map(([currency, t]) => ({ currency, ...t, balanced: d(t.debit).eq(d(t.credit)) })),
    };
  }
}
