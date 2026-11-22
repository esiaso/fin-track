import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Permission } from '@fintrack/shared';
import { AuthUser } from './auth.types';

export const IS_PUBLIC = 'ft:isPublic';
export const PERMISSIONS = 'ft:permissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
