import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SUPER_ADMIN_ONLY_KEY } from './super-admin-only.decorator';

// Fail-closed gate for platform WRITE routes: a route marked @SuperAdminOnly() is
// rejected for any operator that is not SUPER_ADMIN (e.g. SUPPORT). Runs AFTER
// PlatformAuthGuard, which attaches req.platformUser = { id, email, role }.
// This is additive — service methods keep their own assertSuperAdmin() as
// defense-in-depth.
@Injectable()
export class SuperAdminOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      SUPER_ADMIN_ONLY_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest();
    if (req.platformUser?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('This action requires a super-admin.');
    }
    return true;
  }
}
