import { Permission } from '@fintrack/shared';

export interface RoleGrant {
  role: string;
  companyId?: string | null;
  facilityId?: string | null;
}

export interface AuthUser {
  id: string;
  email?: string;
  roles: RoleGrant[];
  permissions: Set<Permission>;
}
