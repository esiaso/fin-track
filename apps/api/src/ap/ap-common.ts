import { Prisma } from '@prisma/client';
import { d, Decimal } from '@fintrack/shared';
import { Tx } from '../prisma/prisma.service';
import { DomainError, Forbidden } from '../common/errors';
import { AuthUser } from '../auth/auth.types';

export const dec = (v: Prisma.Decimal | string | number | null | undefined): Decimal => d(v === null || v === undefined ? '0' : v.toString());
export const s4 = (v: Decimal) => v.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(4);

/** Resolve logical posting keys to GL account ids for a company; throws (retryable) on missing mapping. */
export async function resolveAccounts(tx: Tx, companyId: string, keys: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(keys)];
  const maps = await tx.accountMapping.findMany({ where: { companyId, mappingKey: { in: uniq } } });
  const m = new Map(maps.map((x) => [x.mappingKey, x.accountId]));
  const missing = uniq.filter((k) => !m.has(k));
  if (missing.length) throw new DomainError('MISSING_MAPPING', `Missing account mapping(s): ${missing.join(', ')}`);
  return m;
}

/** Approval limits per role and document type, in base currency. No limits configured => role permission suffices. */
export async function assertApprovalLimit(tx: Tx, user: AuthUser, companyId: string, docType: string, amount: Decimal) {
  const limits = await tx.approvalLimit.findMany({ where: { companyId, docType } });
  if (!limits.length) return;
  const roles = new Set(user.roles.map((r) => r.role));
  if (!limits.some((l) => roles.has(l.role) && dec(l.maxAmount).gte(amount))) {
    throw Forbidden(`${docType} amount ${amount.toFixed(2)} exceeds your approval limit`);
  }
}

/** Lock rows in a deterministic order (by id) to avoid deadlocks between concurrent settlements. */
export async function lockInvoices(tx: Tx, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return;
  await tx.$queryRaw`SELECT id FROM ap_invoices WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
}

export function addDays(date: Date, days: number): Date {
  const x = new Date(date);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export const iso = (dt: Date) => dt.toISOString().slice(0, 10);
