import { createHash } from 'crypto';

/** Deterministic JSON (sorted keys) so hashes are stable across runtimes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = sortKeys(o[k]);
        return acc;
      }, {});
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
