import { Module } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformController } from './platform.controller';

@Module({
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformAuthService, PlatformAuthGuard, PlatformAuditService, PlatformTenantsService],
  exports: [PlatformAuthGuard],
})
export class PlatformModule {}
