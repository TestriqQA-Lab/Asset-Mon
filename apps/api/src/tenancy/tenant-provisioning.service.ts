import { Injectable, Logger } from '@nestjs/common';

/**
 * In the shared-table (MySQL) model, tenant provisioning is just creating rows
 * in the existing tables — there is no per-tenant database to create or migrate.
 * The methods are kept as no-ops so callers that still reference them don't break.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly log = new Logger(TenantProvisioningService.name);

  /** No-op — shared-table model has no per-tenant database. */
  async createDatabase(_dbName: string): Promise<void> {
    this.log.debug(`createDatabase called (no-op in shared-table mode)`);
  }

  /** No-op — shared-table model has no per-tenant migrations. */
  async runMigrations(_dbName: string): Promise<void> {
    this.log.debug(`runMigrations called (no-op in shared-table mode)`);
  }

  /** No-op — shared-table model has no per-tenant database. */
  async migrateAllTenants(): Promise<void> {
    this.log.debug(`migrateAllTenants called (no-op in shared-table mode)`);
  }

  /** No-op — shared-table model has no per-tenant database to drop. */
  async dropDatabase(_dbName: string): Promise<void> {
    this.log.debug(`dropDatabase called (no-op in shared-table mode)`);
  }
}
