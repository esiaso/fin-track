/** Domain error carrying a stable machine code. Mapped to HTTP status by DomainExceptionFilter. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 422,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const NotFound = (what: string, id: string) => new DomainError('NOT_FOUND', `${what} ${id} not found`, 404);
export const Forbidden = (msg: string) => new DomainError('FORBIDDEN', msg, 403);
export const Conflict = (code: string, msg: string, details?: unknown) => new DomainError(code, msg, 409, details);

const DB_CODES: Record<string, number> = {
  FT_UNBALANCED: 422,
  FT_IMMUTABLE: 409,
  FT_PERIOD_LOCKED: 409,
  FT_PERIOD: 422,
  FT_ACCOUNT_COMPANY: 422,
  FT_ACCOUNT_NOT_POSTABLE: 422,
  FT_AUDIT_APPEND_ONLY: 409,
  FT_POSTING: 422,
};

/** Translate errors raised by DB triggers (RAISE EXCEPTION 'FT_xxx: ...') into DomainErrors. */
export function fromDbError(err: unknown): DomainError | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /(FT_[A-Z_]+): ([^\n"]+)/.exec(msg);
  if (!m) return null;
  return new DomainError(m[1], m[2].trim(), DB_CODES[m[1]] ?? 422);
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
