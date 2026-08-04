/**
 * Catalog data (tenants, platform users, support, announcements) used to live in its
 * own Postgres database with its own client. Under the shared-table MySQL model it is
 * the same database as everything else, so this is now an alias for
 * GlobalPrismaService — one class, one instance, one connection pool.
 *
 * Two reasons it matters that these are the *same* client rather than two clients
 * pointed at one database:
 *
 *  • A Prisma transaction cannot span two clients. Provisioning has to write Tenant,
 *    User, TenantUser and the seed rows atomically, which was impossible while catalog
 *    and tenant data were reached through separate connections.
 *
 *  • Two datasource URLs (CATALOG_DATABASE_URL and DATABASE_URL) that are meant to be
 *    identical will eventually diverge in someone's .env, and nothing would report it —
 *    the app would quietly read tenants from one database and their data from another.
 *
 * The name is kept because ~20 platform and auth services inject it, and at those call
 * sites "catalog" still usefully communicates *cross-tenant data*. New code should
 * inject GlobalPrismaService and be explicit via `.unscoped()`.
 */
export { GlobalPrismaService as CatalogPrismaService } from '../tenancy/global-prisma.service';
