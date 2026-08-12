import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, makeAdapter } from '@assetmon/db';
import { scopedClient, type ScopedPrismaClient } from './scoped-client';

/**
 * The single connection to the shared database. Replaces the per-tenant client
 * pool from the database-per-tenant era.
 *
 * Reach it through one of the two accessors below rather than calling model
 * methods on this service directly — which of the two you pick is a statement
 * about whether the query is tenant-confined, and that statement should be
 * visible at the call site.
 *
 * Platform-level data (tenants, platform users, support, announcements) used to live
 * in its own Postgres database reached through a separate `CatalogPrismaService`. It is
 * the same database now, and it matters that it is the same *client* rather than two
 * clients pointed at one database:
 *
 *  • A Prisma transaction cannot span two clients. Provisioning has to write Tenant,
 *    User, TenantUser and the seed rows atomically, which was impossible while the two
 *    kinds of data were reached through separate connections.
 *
 *  • Two datasource URLs meant to be identical will eventually diverge in someone's
 *    .env, and nothing would report it — the app would quietly read tenants from one
 *    database and their data from another.
 *
 * `CATALOG_DATABASE_URL` still exists, but only for the bootstrap CLI and the startup
 * log in main.ts. Nothing in the running application reads it.
 */
@Injectable()
export class GlobalPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * There is no query engine to fall back on, so the adapter is not optional: a client
   * built without one throws before it can run a single query. See makeAdapter in
   * packages/db/src/index.js for why the connection is assembled there.
   */
  constructor() {
    super({ adapter: makeAdapter() });
  }

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
   * though: a database that is unreachable at boot becomes a startup failure, and the
   * process dies before it can serve anything, including /health. That is how the first
   * Hostinger deploys presented — as a 503 behind a deployment marked Completed.
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
