import { Global, Module } from '@nestjs/common';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { GlobalPrismaService } from './global-prisma.service';
import { TenantContextService } from './tenant-context.service';
import { TenantMigrationRunner } from './tenant-migration.runner';

@Global()
@Module({
  providers: [TenantProvisioningService, GlobalPrismaService, TenantContextService, TenantMigrationRunner],
  exports: [TenantProvisioningService, GlobalPrismaService, TenantContextService],
})
export class TenancyModule {}
