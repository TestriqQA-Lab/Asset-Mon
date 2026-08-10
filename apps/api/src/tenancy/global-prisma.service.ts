import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@assetmon/db';
import { scopedClient, type ScopedPrismaClient } from './scoped-client';

/**
 * The single connection to the shared database. Replaces the per-tenant client
 * pool from the database-per-tenant era.
 *
 * Reach it through one of the two accessors below rather than calling model
 * methods on this service directly — which of the two you pick is a statement
 * about whether the query is tenant-confined, and that statement should be
 * visible at the call site.
 */
@Injectable()
export class GlobalPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Tenant-confined access. Every query is filtered and stamped with `tenantId`. */
  forTenant(tenantId: string): ScopedPrismaClient {
    return scopedClient(this, tenantId);
  }

  /**
   * Cross-tenant access with NO automatic filtering — the caller owns isolation
   * and must supply its own `where: { tenantId }` on every tenant-scoped model.
   *
   * Legitimate users are (a) platform-operator services, which are gated behind
   * PlatformAuthGuard and always know which tenant they are acting on, and
   * (b) code that runs before a tenant context exists: login, token refresh,
   * and the JWT guard itself.
   *
   * Anything else should be using `forTenant()`.
   */
  unscoped(): PrismaClient {
    return this;
  }

  /**
   * Warm the connection without blocking startup.
   *
   * Prisma connects lazily on first query, so the explicit connect only moves that cost
   * earlier — measured at 30ms, which buys nothing. Awaiting it does cost something
   * though: any failure inside the engine becomes a startup failure. On Hostinger's
   * shared hosting the engine panics here with "PANIC: timer has gone away", which took
   * the whole application down before it could serve anything, including /health.
   *
   * Firing it off instead keeps the process alive and lets the failure surface on the
   * request that actually needs the database, where the exception filter can turn it
   * into a 500 rather than a dead process.
   */
  onModuleInit() {
    this.$connect().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[prisma] initial connect failed: ${e?.message || e}`);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
