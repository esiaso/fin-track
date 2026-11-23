import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Permission, permissionsFor } from '@fintrack/shared';
import { IS_PUBLIC, PERMISSIONS } from './decorators';
import { AuthUser, RoleGrant } from './auth.types';

/**
 * Global guard: verifies a Bearer JWT (issued by the SynergyOne identity provider; HS256 in dev)
 * and checks route permissions. Facility/company scoping is checked in services via ScopeService.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    let payload: { sub: string; email?: string; roles?: RoleGrant[] };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    const roles = payload.roles ?? [];
    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      roles,
      permissions: permissionsFor(roles.map((r) => r.role)),
    };
    req.user = user;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    return true;
  }
}
