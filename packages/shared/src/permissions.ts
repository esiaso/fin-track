/**
 * Role -> permission matrix. Default proposal; requires finance-team sign-off (see docs/assumptions.md, A-SEC-*).
 * Separation of duties is enforced in services (maker != checker), not only by role assignment.
 */
export const Permission = {
  LEDGER_READ: 'ledger:read',
  JOURNAL_CREATE: 'journal:create',
  JOURNAL_APPROVE: 'journal:approve',
  JOURNAL_POST: 'journal:post',
  JOURNAL_REVERSE: 'journal:reverse',
  PERIOD_MANAGE: 'period:manage',
  ACCOUNT_MANAGE: 'account:manage',
  INTEGRATION_INGEST: 'integration:ingest',
  INTEGRATION_ADMIN: 'integration:admin',
  AUDIT_READ: 'audit:read',
  REPORT_READ: 'report:read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const Role = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  FINANCE_CONTROLLER: 'FINANCE_CONTROLLER',
  CHIEF_ACCOUNTANT: 'CHIEF_ACCOUNTANT',
  ACCOUNTANT: 'ACCOUNTANT',
  AP_OFFICER: 'AP_OFFICER',
  AR_OFFICER: 'AR_OFFICER',
  CLAIMS_MANAGER: 'CLAIMS_MANAGER',
  CLAIMS_OFFICER: 'CLAIMS_OFFICER',
  DEBT_MANAGER: 'DEBT_MANAGER',
  DEBT_OFFICER: 'DEBT_OFFICER',
  PAYROLL_ACCOUNTANT: 'PAYROLL_ACCOUNTANT',
  TREASURY_OFFICER: 'TREASURY_OFFICER',
  AUDITOR: 'AUDITOR',
  INTEGRATION_CLIENT: 'INTEGRATION_CLIENT',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

const P = Permission;
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SYSTEM_ADMIN: [P.INTEGRATION_ADMIN, P.ACCOUNT_MANAGE, P.AUDIT_READ],
  FINANCE_CONTROLLER: [P.LEDGER_READ, P.JOURNAL_APPROVE, P.JOURNAL_POST, P.JOURNAL_REVERSE, P.PERIOD_MANAGE, P.ACCOUNT_MANAGE, P.REPORT_READ, P.AUDIT_READ, P.INTEGRATION_ADMIN],
  CHIEF_ACCOUNTANT: [P.LEDGER_READ, P.JOURNAL_CREATE, P.JOURNAL_APPROVE, P.JOURNAL_POST, P.JOURNAL_REVERSE, P.REPORT_READ],
  ACCOUNTANT: [P.LEDGER_READ, P.JOURNAL_CREATE, P.REPORT_READ],
  AP_OFFICER: [P.LEDGER_READ, P.REPORT_READ],
  AR_OFFICER: [P.LEDGER_READ, P.REPORT_READ],
  CLAIMS_MANAGER: [P.REPORT_READ],
  CLAIMS_OFFICER: [P.REPORT_READ],
  DEBT_MANAGER: [P.REPORT_READ],
  DEBT_OFFICER: [P.REPORT_READ],
  PAYROLL_ACCOUNTANT: [P.LEDGER_READ, P.JOURNAL_CREATE, P.REPORT_READ],
  TREASURY_OFFICER: [P.LEDGER_READ, P.REPORT_READ],
  AUDITOR: [P.LEDGER_READ, P.REPORT_READ, P.AUDIT_READ],
  INTEGRATION_CLIENT: [P.INTEGRATION_INGEST],
};

export function permissionsFor(roles: string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r as Role] ?? []) out.add(p);
  return out;
}
