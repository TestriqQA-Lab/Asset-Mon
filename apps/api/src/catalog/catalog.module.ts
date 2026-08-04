import { Global, Module } from '@nestjs/common';

/**
 * Deliberately empty. `CatalogPrismaService` is now an alias for
 * `GlobalPrismaService`, which the (also @Global) TenancyModule provides — so
 * registering it here too would give Nest two providers for one token and two
 * connection pools, which is exactly what the alias exists to remove.
 *
 * Kept so AppModule's import list is unchanged; it can go once the
 * `CatalogPrismaService` name is retired.
 */
@Global()
@Module({})
export class CatalogModule {}
