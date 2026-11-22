import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Inbound event signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), sent as
 *   X-FinTrack-Timestamp: <unix seconds>
 *   X-FinTrack-Signature: v1=<hex>
 * Including the timestamp prevents replay of captured requests outside the skew window.
 */
export function signBody(secret: string, timestamp: string, rawBody: string | Buffer): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function verifySignature(opts: {
  secret: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer | string;
  maxSkewSeconds: number;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.secret) return { ok: false, reason: 'no secret configured for source' };
  if (!opts.timestamp || !opts.signature) return { ok: false, reason: 'missing signature headers' };
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > opts.maxSkewSeconds) return { ok: false, reason: 'timestamp outside allowed skew' };
  const expected = Buffer.from(signBody(opts.secret, opts.timestamp, opts.rawBody));
  const given = Buffer.from(opts.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}

export function secretFor(sourceSystem: string): string | undefined {
  return process.env[`INTEGRATION_SECRET_${sourceSystem.toUpperCase()}`];
}
