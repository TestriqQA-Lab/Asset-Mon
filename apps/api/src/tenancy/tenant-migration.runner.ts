import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Injectable()
export class TenantMigrationRunner implements OnModuleInit {
  private readonly log = new Logger(TenantMigrationRunner.name);
  constructor(private readonly provisioning: TenantProvisioningService) {}

  async onModuleInit() {
    try {
      await this.provisioning.migrateAllTenants();
    } catch (e: any) {
      this.log.error(`Tenant migration scan failed: ${e.message}`);
    }
  }
}
