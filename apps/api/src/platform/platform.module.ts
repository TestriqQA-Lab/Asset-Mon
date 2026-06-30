import { Module } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformController } from './platform.controller';
import { MfaTicketService } from '../common/mfa/mfa-ticket.service';
import { PlatformMfaService } from './platform-mfa.service';
import { PlatformSetupTicketGuard } from './platform-setup-ticket.guard';
import { PlatformMfaSetupController } from './platform-mfa-setup.controller';
import { PlatformSupportController } from './platform-support.controller';
import { PlatformSupportService } from './platform-support.service';

@Module({
  controllers: [PlatformAuthController, PlatformController, PlatformMfaSetupController, PlatformSupportController],
  providers: [
    PlatformAuthService,
    PlatformAuthGuard,
    PlatformAuditService,
    PlatformTenantsService,
    MfaTicketService,
    PlatformMfaService,
    PlatformSetupTicketGuard,
    PlatformSupportService,
  ],
  exports: [PlatformAuthGuard],
})
export class PlatformModule {}
