import { d, Decimal } from '@fintrack/shared';

export interface BalanceLine {
  currency: string;
  debit: string | Decimal;
  credit: string | Decimal;
  baseDebit?: string | Decimal;
  baseCredit?: string | Decimal;
}

export interface CurrencyBalance {
  currency: string;
  debit: string;
  credit: string;
  difference: string;
}

export interface BalanceResult {
  balanced: boolean;
  byCurrency: CurrencyBalance[];
  base: { debit: string; credit: string; difference: string };
  errors: string[];
}

/**
 * Pure balancing check: a journal balances iff debits = credits for every transaction currency
 * AND in company base currency. Mirrors the DB trigger ft_guard_journals (which is the final authority).
 */
export function checkBalance(lines: BalanceLine[]): BalanceResult {
  const errors: string[] = [];
  if (lines.length < 2) errors.push('A journal needs at least two lines');
  const groups = new Map<string, { dr: Decimal; cr: Decimal }>();
  let baseDr = d(0);
  let baseCr = d(0);
  lines.forEach((l, i) => {
    const dr = d(l.debit);
    const cr = d(l.credit);
    if (dr.isNeg() || cr.isNeg()) errors.push(`Line ${i + 1}: amounts must be non-negative`);
    if (dr.isZero() === cr.isZero()) errors.push(`Line ${i + 1}: exactly one of debit/credit must be non-zero`);
    const cur = l.currency.toUpperCase();
    const g = groups.get(cur) ?? { dr: d(0), cr: d(0) };
    g.dr = g.dr.plus(dr);
    g.cr = g.cr.plus(cr);
    groups.set(cur, g);
    baseDr = baseDr.plus(d(l.baseDebit ?? l.debit));
    baseCr = baseCr.plus(d(l.baseCredit ?? l.credit));
  });
  const byCurrency = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, g]) => ({
      currency,
      debit: g.dr.toFixed(4),
      credit: g.cr.toFixed(4),
      difference: g.dr.minus(g.cr).toFixed(4),
    }));
  for (const c of byCurrency) {
    if (!d(c.difference).isZero()) errors.push(`Currency ${c.currency} out of balance by ${c.difference}`);
  }
  const baseDiff = baseDr.minus(baseCr);
  if (!baseDiff.isZero()) errors.push(`Base currency out of balance by ${baseDiff.toFixed(4)}`);
  return {
    balanced: errors.length === 0,
    byCurrency,
    base: { debit: baseDr.toFixed(4), credit: baseCr.toFixed(4), difference: baseDiff.toFixed(4) },
    errors,
  };
}
