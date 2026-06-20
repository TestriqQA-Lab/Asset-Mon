import { Global, Module } from '@nestjs/common';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantPrismaPool } from './tenant-prisma.pool';
import { TenantContextService } from './tenant-context.service';
import { TenantMigrationRunner } from './tenant-migration.runner';

@Global()
@Module({
  providers: [TenantProvisioningService, TenantPrismaPool, TenantContextService, TenantMigrationRunner],
  exports: [TenantProvisioningService, TenantPrismaPool, TenantContextService],
})
export class TenancyModule {}
