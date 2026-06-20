import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * Enforces `@Roles('ADMIN')` / `@Roles('ADMIN','ASSET_MANAGER')` on routes.
 *
 * No decorator on a route → no role restriction (only JWT auth is required,
 * provided JwtAuthGuard is also in the guard chain). Decorator present →
 * `req.user.role` must be in the allowlist.
 *
 * ADMIN is the workspace owner; ASSET_MANAGER runs day-to-day inventory ops;
 * EMPLOYEE is self-service. ADMIN passes every `@Roles()` check that lists
 * ANY role — the assumption being that ADMIN can do everything a junior role
 * can (so we don't have to spell ADMIN on every decorator).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    const role = req.user?.role;
    if (!role) throw new ForbiddenException('Authentication required');
    if (role === 'ADMIN') return true;
    if (required.includes(role)) return true;
    throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
  }
}
