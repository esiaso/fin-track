import { Permission, ROLE_PERMISSIONS, Role } from '@fintrack/shared';
import { Forbidden } from '../common/errors';
import { AuthUser } from './auth.types';

/**
 * True if the user holds `perm` through a role grant whose scope covers the company (and facility, if given).
 * A grant with null companyId/facilityId is unrestricted on that axis.
 */
export function hasScopedPermission(user: AuthUser, perm: Permission, companyId: string, facilityId?: string | null): boolean {
  return user.roles.some(
    (g) =>
      (ROLE_PERMISSIONS[g.role as Role] ?? []).includes(perm) &&
      (!g.companyId || g.companyId === companyId) &&
      (!g.facilityId || !facilityId || g.facilityId === facilityId),
  );
}

export function assertScope(user: AuthUser, perm: Permission, companyId: string, facilityId?: string | null): void {
  if (!hasScopedPermission(user, perm, companyId, facilityId)) {
    throw Forbidden(`No ${perm} access for company ${companyId}${facilityId ? ` / facility ${facilityId}` : ''}`);
  }
}
