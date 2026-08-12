import { Global, Module } from '@nestjs/common';
import { GlobalPrismaService } from './global-prisma.service';
import { TenantContextService } from './tenant-context.service';

@Global()
@Module({
  providers: [GlobalPrismaService, TenantContextService],
  exports: [GlobalPrismaService, TenantContextService],
})
export class TenancyModule {}
