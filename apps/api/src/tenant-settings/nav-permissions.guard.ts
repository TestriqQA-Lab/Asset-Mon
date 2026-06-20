import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import {
  mergePermissions, navForRole, type NavKey,
} from './tenant-settings.types';
import { REQUIRE_NAV_KEY } from './require-nav.decorator';

/**
 * Companion to `JwtAuthGuard` + `RolesGuard`. When a route is decorated with
 * `@RequireNav('settings:modules')`, this guard reads the tenant's permissions
 * matrix from the catalog DB and rejects the request unless the caller's role
 * has that nav key enabled.
 *
 * ADMIN always passes (handled by `navForRole`). Settings are cached per
 * request via the standard Prisma round-trip — at one read per protected
 * request, this is fine for the size of tenant-settings JSON. If the matrix
 * grows hot, lift it into a 30s in-memory cache keyed by tenant id.
 */
@Injectable()
export class NavPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly catalog: CatalogPrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const navKey = this.reflector.getAllAndOverride<NavKey | undefined>(
      REQUIRE_NAV_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!navKey) return true;

    const req = ctx.switchToHttp().getRequest();
    const role = req.user?.role;
    const tid = req.user?.tid;
    if (!role || !tid) throw new ForbiddenException('Authentication required');
    if (role === 'ADMIN') return true;

    const t = await this.catalog.tenant.findUnique({
      where: { id: tid },
      select: { settings: true },
    });
    const perms = mergePermissions((t?.settings as any)?.permissions);
    const nav = navForRole(role, perms);
    if (nav[navKey]) return true;
    throw new ForbiddenException(`Your role does not have access to "${navKey}"`);
  }
}
