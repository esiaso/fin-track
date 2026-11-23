import { signBody, verifySignature } from './signature';

describe('event signatures', () => {
  const secret = 's3cret';
  const body = '{"a":1}';
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);

  it('accepts a valid signature', () => {
    expect(verifySignature({ secret, timestamp: ts, signature: signBody(secret, ts, body), rawBody: body, maxSkewSeconds: 300, now })).toEqual({ ok: true });
  });
  it('rejects tampered body', () => {
    const r = verifySignature({ secret, timestamp: ts, signature: signBody(secret, ts, body), rawBody: '{"a":2}', maxSkewSeconds: 300, now });
    expect(r.ok).toBe(false);
  });
  it('rejects stale timestamp (replay)', () => {
    const old = String(now / 1000 - 3600);
    const r = verifySignature({ secret, timestamp: old, signature: signBody(secret, old, body), rawBody: body, maxSkewSeconds: 300, now });
    expect(r).toEqual({ ok: false, reason: 'timestamp outside allowed skew' });
  });
  it('rejects wrong secret and missing secret', () => {
    expect(verifySignature({ secret, timestamp: ts, signature: signBody('other', ts, body), rawBody: body, maxSkewSeconds: 300, now }).ok).toBe(false);
    expect(verifySignature({ secret: undefined, timestamp: ts, signature: 'v1=00', rawBody: body, maxSkewSeconds: 300, now }).ok).toBe(false);
  });
});
