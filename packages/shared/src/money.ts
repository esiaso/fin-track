import Decimal from 'decimal.js';

/**
 * Decimal-safe money helpers. Never use JS `number` for currency amounts.
 * Amounts are carried as strings over the wire and as Decimal in memory.
 * Storage precision is NUMERIC(20,4); presentation rounding is per-currency.
 */
export const MoneyDecimal = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });
export type DecimalLike = Decimal.Value | { toString(): string };

export const STORAGE_SCALE = 4;

/** ISO-4217 minor units for currencies we expect to see. */
export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  KES: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  UGX: 0,
  TZS: 2,
  RWF: 0,
};

export function d(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new MoneyDecimal(0);
  return new MoneyDecimal(typeof value === 'object' ? value.toString() : value);
}

export function isValidAmount(value: string): boolean {
  return /^-?\d{1,16}(\.\d{1,4})?$/.test(value);
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new MoneyDecimal(0));
}

/** Round to storage scale (4dp) using banker's rounding. */
export function toStorage(value: DecimalLike): string {
  return d(value).toDecimalPlaces(STORAGE_SCALE, Decimal.ROUND_HALF_EVEN).toFixed(STORAGE_SCALE);
}

/** Round to the currency's minor unit for presentation / payment files. */
export function toCurrencyUnits(value: DecimalLike, currency: string): string {
  const dp = CURRENCY_MINOR_UNITS[currency.toUpperCase()] ?? 2;
  return d(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN).toFixed(dp);
}

/**
 * Split an amount by percentage weights so that the parts sum exactly to the total.
 * Remainder from rounding is assigned to the largest-weight part (deterministic).
 */
export function allocateByWeights(total: DecimalLike, weights: DecimalLike[], scale = STORAGE_SCALE): string[] {
  const t = d(total);
  const ws = weights.map(d);
  const wSum = sum(ws);
  if (wSum.lte(0)) throw new Error('Weights must sum to a positive value');
  const parts = ws.map((w) => t.mul(w).div(wSum).toDecimalPlaces(scale, Decimal.ROUND_DOWN));
  const remainder = t.minus(sum(parts));
  let maxIdx = 0;
  ws.forEach((w, i) => {
    if (w.gt(ws[maxIdx])) maxIdx = i;
  });
  parts[maxIdx] = parts[maxIdx].plus(remainder);
  return parts.map((p) => p.toFixed(scale));
}

export { Decimal };
